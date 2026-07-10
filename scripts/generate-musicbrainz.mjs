#!/usr/bin/env node
/**
 * Generates music trivia questions from the MusicBrainz API
 * (https://musicbrainz.org/ws/2/) into the question bank format used by
 * data/trivia/questions/.
 *
 * MusicBrainz core data is public domain (CC0) — see the source/license
 * fields written into the output file. No API key needed, but the API
 * requires a descriptive User-Agent and strictly one request per second,
 * so a full run takes a few minutes. Never parallelize the requests.
 *
 * Strategy: answerability is everything. Artists are seeded per genre from
 * MusicBrainz tag search, whose relevance scoring surfaces well-known names
 * first (tag vote counts act as a popularity proxy). For each artist we
 * fetch official studio albums (primary type Album, no Live/Compilation/etc.
 * secondary types) and build three question templates around them, with
 * distractors drawn from the same genre so every wrong answer is plausible.
 *
 * Idempotent: questions are deduplicated against every file in
 * data/trivia/questions/ by id and by normalized prompt text, so re-running
 * only appends new questions.
 *
 * Usage:
 *   node scripts/generate-musicbrainz.mjs                # target ~200 questions
 *   node scripts/generate-musicbrainz.mjs --amount 50    # smaller batch
 *   node scripts/generate-musicbrainz.mjs --out data/trivia/questions/retired/musicbrainz-generated.json
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const API_BASE = "https://musicbrainz.org/ws/2";
const USER_AGENT = "orinks-net-midnight-signal/1.0 (notifications@orinks.net)";
const RATE_LIMIT_MS = 1100; // MusicBrainz allows strictly 1 request/second
const CURRENT_YEAR = new Date().getFullYear();
const ARTISTS_PER_GENRE = 10;
const ALBUMS_PER_ARTIST = 8;
const MAX_QUESTIONS_PER_ARTIST = 4;

// Genres double as the distractor pools: wrong answers for a question are
// always drawn from the same genre so nothing is trivially eliminable.
const GENRES = [
  { tag: "rock", label: "rock" },
  { tag: "pop", label: "pop" },
  { tag: "jazz", label: "jazz" },
  { tag: "hip hop", label: "hip hop" },
  { tag: "country", label: "country" },
  { tag: "electronic", label: "electronic" },
  { tag: "metal", label: "metal" },
  { tag: "soul", label: "soul" },
  { tag: "reggae", label: "reggae" },
  // Release years are meaningless trivia for classical composers (the album
  // is a modern recording), so classical only uses the album-match template.
  { tag: "classical", label: "classical", templates: ["albumByArtist"] },
];

const DEFAULT_TEMPLATES = ["artistOfAlbum", "yearOfAlbum", "albumByArtist"];

// MusicBrainz special-purpose artists that must never become answers.
const SPECIAL_ARTISTS = new Set(["Various Artists", "[unknown]", "[no artist]"]);

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    amount: 200,
    out: "data/trivia/questions/retired/musicbrainz-generated.json",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--amount") args.amount = Number(argv[++i]);
    else if (arg === "--out") args.out = argv[++i];
    else fail(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(args.amount) || args.amount < 1) fail("--amount must be a positive integer");
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePrompt(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeTitle(text) {
  // Loose normalization for comparing titles/names (self-titled detection,
  // duplicate choices): fold typographic punctuation and case.
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** True when the text is readable for an English-speaking audience. */
function isLatinReadable(text) {
  // Allow Latin (incl. Latin-1/Extended), digits, and common punctuation.
  // Reject anything containing other scripts (Cyrillic, CJK, Greek, ...).
  return !/[^ -ɏḀ-ỿ -⁯™]/iu.test(text);
}

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function pickRandom(array, count, excludeIndex = -1) {
  const pool = array.filter((_, i) => i !== excludeIndex);
  return shuffle(pool).slice(0, count);
}

/** Gather ids and normalized prompts from every existing question file. */
function loadExisting() {
  const ids = new Set();
  const prompts = new Set();
  const questionsDir = path.join(root, "data/trivia/questions");
  if (!existsSync(questionsDir)) return { ids, prompts };
  for (const file of readdirSync(questionsDir).filter((f) => f.endsWith(".json"))) {
    const bank = JSON.parse(readFileSync(path.join(questionsDir, file), "utf8"));
    for (const q of bank.questions ?? []) {
      ids.add(q.id);
      prompts.add(normalizePrompt(q.prompt));
    }
  }
  return { ids, prompts };
}

let lastRequestAt = 0;

async function apiGet(pathname, attempt = 1) {
  const wait = lastRequestAt + RATE_LIMIT_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  const res = await fetch(`${API_BASE}${pathname}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (res.status === 503 || res.status === 429) {
    if (attempt >= 5) throw new Error(`MusicBrainz rate limit persisted after ${attempt} tries`);
    const backoff = RATE_LIMIT_MS * 2 ** attempt;
    console.log(`  Rate limited (HTTP ${res.status}); backing off ${backoff}ms...`);
    await sleep(backoff);
    return apiGet(pathname, attempt + 1);
  }
  if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status} for ${pathname}`);
  return res.json();
}

/**
 * Top artists for a genre tag. MusicBrainz search relevance for tag queries
 * correlates with how often the tag was applied, which surfaces household
 * names first — exactly what answerable trivia needs. But heavily-tagged
 * mega-artists rank high for EVERY tag query (The Beatles show up under
 * "metal"), so we also require the genre to be a dominant tag on the artist
 * itself, keeping each genre's distractor pool coherent. `claimed` dedupes
 * artists across genres — the first genre wins.
 */
async function fetchGenreArtists(genre, claimed) {
  const query = encodeURIComponent(`tag:"${genre.tag}"`);
  const data = await apiGet(`/artist?query=${query}&fmt=json&limit=100`);
  const artists = [];
  for (const raw of data.artists ?? []) {
    const name = raw.name?.trim();
    if (!name || SPECIAL_ARTISTS.has(name)) continue;
    if (!isLatinReadable(name)) continue;
    if (claimed.has(raw.id)) continue;
    const tags = (raw.tags ?? []).filter((t) => (t.count ?? 0) > 0);
    const genreTag = tags.find((t) => t.name?.toLowerCase() === genre.tag);
    if (!genreTag) continue;
    const topCount = Math.max(...tags.map((t) => t.count));
    // The genre must be one of the artist's defining tags, not a stray vote.
    if (genreTag.count < 3 || genreTag.count < topCount * 0.3) continue;
    claimed.add(raw.id);
    artists.push({ id: raw.id, name, score: raw.score ?? 0 });
    if (artists.length >= ARTISTS_PER_GENRE) break;
  }
  return artists;
}

/** Official studio albums: primary type Album, no secondary types. */
async function fetchStudioAlbums(artist, stats) {
  const data = await apiGet(
    `/release-group?artist=${artist.id}&type=album&fmt=json&limit=100`,
  );
  const albums = [];
  const seenTitles = new Set();
  for (const rg of data["release-groups"] ?? []) {
    if (rg["primary-type"] !== "Album") continue;
    if ((rg["secondary-types"] ?? []).length > 0) {
      stats.skipped.secondaryType++;
      continue;
    }
    const title = rg.title?.trim();
    const year = Number((rg["first-release-date"] ?? "").slice(0, 4));
    if (!title || !Number.isInteger(year) || year < 1900 || year > CURRENT_YEAR) {
      stats.skipped.noDate++;
      continue;
    }
    if (!isLatinReadable(title)) {
      stats.skipped.nonLatin++;
      continue;
    }
    if (title.length > 70) {
      stats.skipped.longTitle++;
      continue;
    }
    const key = normalizeTitle(title);
    if (!key || seenTitles.has(key)) continue;
    seenTitles.add(key);
    albums.push({ title, year });
  }
  // Earliest releases first: an artist's early catalog is usually the famous
  // part, and depth in this list feeds the difficulty heuristic.
  albums.sort((a, b) => a.year - b.year);
  return albums.slice(0, ALBUMS_PER_ARTIST);
}

/** Does this album title leak the artist's name (or vice versa)? */
function titleLeaksArtist(albumTitle, artistName) {
  const title = normalizeTitle(albumTitle);
  const name = normalizeTitle(artistName);
  if (!title || !name) return true;
  if (title === name) return true;
  if (title.includes(name) || name.includes(title)) return true;
  // Any distinctive word of the artist name appearing in the title (catches
  // "Bach: The Brandenburg Concertos" for Johann Sebastian Bach).
  const stop = new Set(["the", "and", "band", "los", "las", "der", "die", "de", "of"]);
  for (const word of name.split(" ")) {
    if (word.length >= 3 && !stop.has(word) && title.split(" ").includes(word)) return true;
  }
  return false;
}

/**
 * Difficulty heuristic (rough by design): household names with early catalog
 * albums are easy; lesser-known artists and deep cuts get harder. Year
 * questions are a notch harder than name-the-artist questions.
 */
function difficultyFor(artistRank, albumDepth, template) {
  let d = artistRank < 3 ? 1 : artistRank < 6 ? 2 : 3;
  if (albumDepth >= 3) d += 1;
  if (albumDepth >= 6) d += 1;
  if (template === "yearOfAlbum") d += 1;
  return Math.min(5, Math.max(1, d));
}

function uniqueChoices(choices) {
  const seen = new Set();
  for (const choice of choices) {
    const key = normalizeTitle(choice);
    if (!key || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/** Plausible wrong years within ±2–6 of the real one, none in the future. */
function yearDistractors(year) {
  const offsets = shuffle([-6, -5, -4, -3, -2, 2, 3, 4, 5, 6]);
  const picked = new Set();
  for (const offset of offsets) {
    const candidate = year + offset;
    if (candidate > CURRENT_YEAR || candidate < 1900) continue;
    picked.add(candidate);
    if (picked.size === 3) break;
  }
  return picked.size === 3 ? [...picked] : null;
}

function buildQuestion({ template, artist, album, genreArtists, artistAlbums, stats }) {
  const artistIndex = genreArtists.findIndex((a) => a.id === artist.entry.id);

  if (template === "artistOfAlbum") {
    // Self-titled albums (or any title leaking the name) give it away.
    if (titleLeaksArtist(album.title, artist.entry.name)) {
      stats.skipped.selfTitled++;
      return null;
    }
    const distractors = pickRandom(genreArtists, 3, artistIndex).map((a) => a.name);
    if (distractors.length < 3) return null;
    const choices = shuffle([artist.entry.name, ...distractors]);
    if (!uniqueChoices(choices)) return null;
    return {
      prompt: `Which artist released the album "${album.title}" in ${album.year}?`,
      choices,
      answer: choices.indexOf(artist.entry.name),
    };
  }

  if (template === "yearOfAlbum") {
    const wrongYears = yearDistractors(album.year);
    if (!wrongYears) return null;
    const choices = shuffle([album.year, ...wrongYears]).map(String);
    if (!uniqueChoices(choices)) return null;
    return {
      prompt: `In which year was "${album.title}" by ${artist.entry.name} first released?`,
      choices,
      answer: choices.indexOf(String(album.year)),
    };
  }

  if (template === "albumByArtist") {
    // A title containing the artist's name would answer itself.
    if (titleLeaksArtist(album.title, artist.entry.name)) {
      stats.skipped.selfTitled++;
      return null;
    }
    const others = pickRandom(genreArtists, 3, artistIndex);
    if (others.length < 3) return null;
    const distractorAlbums = [];
    for (const other of others) {
      const pool = (artistAlbums.get(other.id) ?? []).filter(
        (a) =>
          !titleLeaksArtist(a.title, other.name) && // don't hint at the real owner
          !titleLeaksArtist(a.title, artist.entry.name), // must not look like the answer artist's
      );
      if (pool.length === 0) return null;
      distractorAlbums.push(pool[Math.floor(Math.random() * pool.length)].title);
    }
    const choices = shuffle([album.title, ...distractorAlbums]);
    if (!uniqueChoices(choices)) return null;
    return {
      prompt: `Which of these albums is by ${artist.entry.name}?`,
      choices,
      answer: choices.indexOf(album.title),
    };
  }

  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outAbs = path.join(root, args.out);
  const existing = loadExisting();

  const stats = {
    perTemplate: {},
    perGenre: {},
    perDifficulty: {},
    skipped: { secondaryType: 0, noDate: 0, nonLatin: 0, longTitle: 0, selfTitled: 0 },
    duplicates: 0,
    rejected: 0,
  };

  console.log(`Target: ${args.amount} questions across ${GENRES.length} genres.`);
  console.log("MusicBrainz allows 1 request/second — this takes a few minutes.\n");

  // Phase 1: top artists per genre.
  const genreData = [];
  const claimed = new Set();
  for (const genre of GENRES) {
    const artists = await fetchGenreArtists(genre, claimed);
    console.log(`[${genre.label}] seeded ${artists.length} artists (top: ${artists.slice(0, 3).map((a) => a.name).join(", ")})`);
    genreData.push({ genre, artists, albums: new Map() });
  }

  // Phase 2: studio albums per artist.
  for (const data of genreData) {
    for (const artist of data.artists) {
      const albums = await fetchStudioAlbums(artist, stats);
      data.albums.set(artist.id, albums);
    }
    const total = [...data.albums.values()].reduce((n, a) => n + a.length, 0);
    console.log(`[${data.genre.label}] fetched ${total} studio albums`);
  }

  // Phase 3: round-robin question assembly across genres, rotating artists,
  // albums, and templates so no single artist or template dominates.
  const generated = [];
  const perArtistCount = new Map();
  let templateCursor = 0;
  let exhausted = false;
  const cursors = genreData.map(() => ({ artist: 0, album: 0 }));

  while (generated.length < args.amount && !exhausted) {
    exhausted = true;
    for (let g = 0; g < genreData.length && generated.length < args.amount; g++) {
      const { genre, artists, albums } = genreData[g];
      const templates = genre.templates ?? DEFAULT_TEMPLATES;
      const cursor = cursors[g];
      let produced = false;

      // Try each artist once per round, starting where we left off.
      for (let tries = 0; tries < artists.length && !produced; tries++) {
        const artistEntry = artists[cursor.artist % artists.length];
        cursor.artist++;
        const artistAlbumList = albums.get(artistEntry.id) ?? [];
        if (artistAlbumList.length === 0) continue;
        if ((perArtistCount.get(artistEntry.id) ?? 0) >= MAX_QUESTIONS_PER_ARTIST) continue;

        const albumDepth = cursor.album % artistAlbumList.length;
        const album = artistAlbumList[albumDepth];
        const template = templates[templateCursor % templates.length];
        templateCursor++;

        const built = buildQuestion({
          template,
          artist: { entry: artistEntry },
          album,
          genreArtists: artists,
          artistAlbums: albums,
          stats,
        });
        if (!built) {
          stats.rejected++;
          continue;
        }

        const id = `mb-${createHash("sha256").update(built.prompt).digest("hex").slice(0, 8)}`;
        const promptKey = normalizePrompt(built.prompt);
        if (existing.ids.has(id) || existing.prompts.has(promptKey)) {
          stats.duplicates++;
          continue;
        }
        existing.ids.add(id);
        existing.prompts.add(promptKey);

        const difficulty = difficultyFor(
          artists.findIndex((a) => a.id === artistEntry.id),
          albumDepth,
          template,
        );
        generated.push({
          id,
          category: "music",
          difficulty,
          prompt: built.prompt,
          choices: built.choices,
          answer: built.answer,
          source: "musicbrainz",
        });
        perArtistCount.set(artistEntry.id, (perArtistCount.get(artistEntry.id) ?? 0) + 1);
        stats.perTemplate[template] = (stats.perTemplate[template] ?? 0) + 1;
        stats.perGenre[genre.label] = (stats.perGenre[genre.label] ?? 0) + 1;
        stats.perDifficulty[difficulty] = (stats.perDifficulty[difficulty] ?? 0) + 1;
        produced = true;
        exhausted = false;
      }
      if (produced) cursors[g].album++;
    }
  }

  // Phase 4: merge into the bank file (idempotent append).
  const bank = existsSync(outAbs)
    ? JSON.parse(readFileSync(outAbs, "utf8"))
    : {
        minigame: "general-trivia",
        voice: "clide",
        source: "MusicBrainz (https://musicbrainz.org)",
        license:
          "MusicBrainz core data is placed into the public domain (CC0) — https://musicbrainz.org/doc/About/Data_License",
        curated: false,
        questions: [],
      };
  bank.questions.push(...generated);
  writeFileSync(outAbs, `${JSON.stringify(bank, null, 2)}\n`);

  console.log("");
  console.log(`Generated ${generated.length} new questions into ${args.out}`);
  console.log(`Per template: ${JSON.stringify(stats.perTemplate)}`);
  console.log(`Per genre:    ${JSON.stringify(stats.perGenre)}`);
  console.log(`Difficulty:   ${JSON.stringify(stats.perDifficulty)}`);
  console.log(`Skipped:      ${JSON.stringify(stats.skipped)}`);
  if (stats.duplicates > 0) console.log(`Duplicates already in the bank: ${stats.duplicates}`);
  if (stats.rejected > 0) console.log(`Rejected by quality guards: ${stats.rejected}`);
  console.log(`Total in file: ${bank.questions.length}`);
  console.log("Reminder: curate before deploying — the difficulty heuristic is rough.");
}

main().catch((err) => fail(err.message));
