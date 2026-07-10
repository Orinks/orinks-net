#!/usr/bin/env node
/**
 * Pre-generates host audio for the music trivia roguelite via the ElevenLabs API.
 *
 * Reads data/trivia/barks.json and data/trivia/questions/*.json, generates one MP3
 * per line into public/audio/trivia/, and writes public/audio/trivia/manifest.json
 * mapping line/question IDs to web paths.
 *
 * Idempotent: files are named by a hash of voice + model + settings + text, so
 * unchanged lines are never regenerated. Run it again after credits refresh to
 * pick up where it left off.
 *
 * Usage:
 *   node scripts/generate-tts.mjs --dry-run          # show what would be generated, no API calls
 *   node scripts/generate-tts.mjs                    # generate up to the default 5000-char budget
 *   node scripts/generate-tts.mjs --budget 20000     # explicit live character ceiling
 *   node scripts/generate-tts.mjs --dry-run --budget 0 # complete plan; unlimited is dry-run only
 *   node scripts/generate-tts.mjs --reserve-credits 500 # retain an included-credit safety margin
 *   node scripts/generate-tts.mjs --sync-manifest --prune-orphans # no API calls
 *   node scripts/generate-tts.mjs --only barks       # barks | questions | story
 *   node scripts/generate-tts.mjs --filter gt-00     # only items whose id contains this string
 *
 * Requires ELEVENLABS_API_KEY in the environment or .env.local (never commit it).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSafeGenerationBudget,
  audioHash,
  buildQuestionAudioPlan,
  validateGenerationBudget,
} from "./trivia-audio-core.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_BUDGET = 5000;

function parseArgs(argv) {
  const args = {
    dryRun: false,
    budget: DEFAULT_BUDGET,
    only: null,
    filter: null,
    reserveCredits: null,
    syncManifest: false,
    pruneOrphans: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--sync-manifest") args.syncManifest = true;
    else if (arg === "--prune-orphans") args.pruneOrphans = true;
    else if (arg === "--budget") args.budget = Number(argv[++i]);
    else if (arg === "--only") args.only = argv[++i];
    else if (arg === "--filter") args.filter = argv[++i];
    else if (arg === "--reserve-credits") args.reserveCredits = Number(argv[++i]);
    else fail(`Unknown argument: ${arg}`);
  }
  if (args.dryRun && args.syncManifest) fail("--dry-run and --sync-manifest cannot be combined");
  if (args.pruneOrphans && !args.syncManifest) fail("--prune-orphans requires --sync-manifest");
  try {
    validateGenerationBudget(args);
  } catch (error) {
    fail(error.message);
  }
  if (
    args.reserveCredits !== null &&
    (!Number.isFinite(args.reserveCredits) || args.reserveCredits < 0)
  ) {
    fail("--reserve-credits must be a non-negative number");
  }
  if (args.only && !["barks", "questions", "story"].includes(args.only)) {
    fail("--only must be 'barks', 'questions', or 'story'");
  }
  return args;
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function loadJson(relPath) {
  const abs = path.join(root, relPath);
  if (!existsSync(abs)) fail(`Missing file: ${relPath}`);
  try {
    return JSON.parse(readFileSync(abs, "utf8"));
  } catch (err) {
    fail(`Invalid JSON in ${relPath}: ${err.message}`);
  }
}

function loadEnvLocal() {
  const envPath = path.join(root, ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

/** Collect every line that needs audio, validating as we go. */
export function collectItems(config) {
  const items = [];
  const seenIds = new Set();

  function addItem(kind, id, text, voiceName, sourceFile, metadata = {}) {
    if (!id || typeof id !== "string") fail(`${sourceFile}: item missing string "id"`);
    if (seenIds.has(id)) fail(`${sourceFile}: duplicate id "${id}"`);
    seenIds.add(id);
    if (!text || typeof text !== "string") fail(`${sourceFile}: item "${id}" missing string text`);
    const voice = config.voices[voiceName];
    if (!voice) fail(`${sourceFile}: item "${id}" references unknown voice "${voiceName}"`);
    items.push({ kind, id, text, voiceName, voice, ...metadata });
  }

  const barks = loadJson("data/trivia/barks.json");
  const barkVoice = barks.voice ?? config.defaultVoice;
  if (!Array.isArray(barks.lines)) fail("barks.json: missing 'lines' array");
  for (const line of barks.lines) {
    addItem("barks", line.id, line.text, line.voice ?? barkVoice, "barks.json");
  }

  // Story content (master tapes + season lines); Producer lines in
  // producer.json are Web Speech only and never generate audio.
  if (existsSync(path.join(root, "data/trivia/story.json"))) {
    const story = loadJson("data/trivia/story.json");
    const storyVoice = story.voice ?? config.defaultVoice;
    for (const tape of story.tapes ?? []) {
      addItem("story", tape.id, tape.text, tape.voice ?? storyVoice, "story.json");
    }
    for (const line of story.seasonLines ?? []) {
      addItem("story", line.id, line.text, line.voice ?? storyVoice, "story.json");
    }
    for (const line of story.finale?.lines ?? []) {
      addItem("story", line.id, line.text, line.voice ?? storyVoice, "story.json");
    }
    for (const line of story.epilogueLines ?? []) {
      addItem("story", line.id, line.text, line.voice ?? storyVoice, "story.json");
    }
  }

  const questionsDir = path.join(root, "data/trivia/questions");
  const questionFiles = existsSync(questionsDir)
    ? readdirSync(questionsDir).filter((f) => f.endsWith(".json"))
    : [];
  for (const file of questionFiles) {
    const relPath = `data/trivia/questions/${file}`;
    const bank = loadJson(relPath);
    if (!Array.isArray(bank.questions)) fail(`${relPath}: missing 'questions' array`);
    const bankVoice = bank.voice ?? config.defaultVoice;
    for (const q of bank.questions) {
      if (!Array.isArray(q.choices) || q.choices.length < 2) {
        fail(`${relPath}: question "${q.id}" needs at least 2 choices`);
      }
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) {
        fail(`${relPath}: question "${q.id}" has out-of-range answer index`);
      }
      if (q.voice === false) continue; // authored as text/screen-reader only
      let audioPlan;
      try {
        audioPlan = buildQuestionAudioPlan(q);
      } catch (error) {
        fail(`${relPath}: question "${q.id}" has invalid narration guidance: ${error.message}`);
      }
      addItem(
        "questions",
        q.id,
        audioPlan.text,
        typeof q.voice === "string" ? q.voice : bankVoice,
        relPath,
        {
          displayText: audioPlan.displayText,
          pronunciation: audioPlan.pronunciation,
        },
      );
    }
  }

  return items;
}

async function generateAudio(config, item, apiKey) {
  const url = `${config.apiBase}/text-to-speech/${item.voice.voiceId}?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: item.text,
      model_id: config.modelId,
      voice_settings: item.voice.settings ?? undefined,
    }),
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs generation returned HTTP ${res.status} for "${item.id}".`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function loadCreditStatus(config, apiKey) {
  const res = await fetch(`${config.apiBase}/user/subscription`, {
    cache: "no-store",
    headers: { "xi-api-key": apiKey },
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs subscription check returned HTTP ${res.status}.`);
  }
  const sub = await res.json();
  if (
    typeof sub.character_count !== "number" ||
    typeof sub.character_limit !== "number" ||
    sub.character_count < 0 ||
    sub.character_limit < sub.character_count
  ) {
    throw new Error("ElevenLabs subscription response did not contain a safe credit balance.");
  }
  return {
    usedCredits: sub.character_count,
    limitCredits: sub.character_limit,
    remainingCredits: sub.character_limit - sub.character_count,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvLocal();

  const config = loadJson("data/trivia/tts.config.json");
  const items = collectItems(config);
  const outputDir = path.join(root, config.outputDir);
  const manifestAbs = path.join(root, config.manifestPath);

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!args.dryRun && !args.syncManifest && !apiKey) {
    fail("ELEVENLABS_API_KEY is not set (add it to .env.local or the environment), or use --dry-run.");
  }
  if (!args.dryRun && !args.syncManifest) {
    const creditMultiplier = config.creditMultiplier;
    const reserveCredits = args.reserveCredits ?? config.reserveCredits ?? 500;
    if (!Number.isFinite(creditMultiplier) || creditMultiplier <= 0) {
      fail("tts.config.json must define a positive creditMultiplier for live generation.");
    }
    const credits = await loadCreditStatus(config, apiKey);
    const safe = assertSafeGenerationBudget({
      requestedCharacters: args.budget,
      creditMultiplier,
      remainingCredits: credits.remainingCredits,
      reserveCredits,
    });
    console.log(
      `ElevenLabs included credits: ${credits.usedCredits}/${credits.limitCredits} used; ` +
        `${safe.usableCredits} safely usable after reserve.`,
    );
    console.log(
      `Generation ceiling: ${args.budget} characters, at most ${safe.requestedCredits} credits.`,
    );
  }

  const manifest = { generatedAt: new Date().toISOString(), barks: {}, questions: {}, story: {} };
  const stats = { existing: 0, generated: 0, generatedChars: 0, pending: 0, pendingChars: 0, skipped: 0 };
  let budgetLeft = args.budget === 0 ? Infinity : args.budget;

  for (const item of items) {
    const hash = audioHash(item, config.modelId);
    const fileRel = path.join(item.kind, `${hash}.mp3`);
    const fileAbs = path.join(outputDir, fileRel);
    const webPath = `/${path.posix.join(config.outputDir.replace(/^public\//, ""), item.kind, `${hash}.mp3`)}`;

    if (existsSync(fileAbs)) {
      manifest[item.kind][item.id] = webPath;
      stats.existing++;
      continue;
    }

    const inScope =
      (!args.only || args.only === item.kind) && (!args.filter || item.id.includes(args.filter));
    if (!inScope) {
      stats.skipped++;
      continue;
    }

    if (item.text.length > budgetLeft) {
      stats.pending++;
      stats.pendingChars += item.text.length;
      continue;
    }

    if (args.dryRun) {
      console.log(`[dry-run] would generate ${item.kind}/${item.id} (${item.text.length} chars)`);
      stats.generated++;
      stats.generatedChars += item.text.length;
      budgetLeft -= item.text.length;
      continue;
    }

    if (args.syncManifest) {
      stats.pending++;
      stats.pendingChars += item.text.length;
      continue;
    }

    if (item.voice.voiceId.startsWith("REPLACE_")) {
      fail(`Voice "${item.voiceName}" still has a placeholder voiceId in tts.config.json.`);
    }

    console.log(`Generating ${item.kind}/${item.id} (${item.text.length} chars)...`);
    const audio = await generateAudio(config, item, apiKey);
    mkdirSync(path.dirname(fileAbs), { recursive: true });
    writeFileSync(fileAbs, audio);
    manifest[item.kind][item.id] = webPath;
    stats.generated++;
    stats.generatedChars += item.text.length;
    budgetLeft -= item.text.length;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  if (!args.dryRun) {
    mkdirSync(path.dirname(manifestAbs), { recursive: true });
    writeFileSync(manifestAbs, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  if (args.pruneOrphans) {
    let pruned = 0;
    for (const kind of ["barks", "questions", "story"]) {
      const kindDir = path.join(outputDir, kind);
      if (!existsSync(kindDir)) continue;
      const referenced = new Set(
        Object.values(manifest[kind]).map((webPath) => path.basename(webPath)),
      );
      for (const file of readdirSync(kindDir)) {
        if (!file.endsWith(".mp3") || referenced.has(file)) continue;
        unlinkSync(path.join(kindDir, file));
        pruned++;
      }
    }
    console.log(`Pruned orphaned audio files: ${pruned}`);
  }

  console.log("");
  console.log(`Already generated: ${stats.existing}`);
  console.log(
    `${args.dryRun ? "Would generate" : args.syncManifest ? "Generated during sync" : "Generated"}: ${stats.generated} (${stats.generatedChars} chars)`,
  );
  if (stats.pending > 0) {
    console.log(`Over budget, waiting for next batch: ${stats.pending} (${stats.pendingChars} chars)`);
  }
  if (stats.skipped > 0) {
    console.log(`Outside --only/--filter scope: ${stats.skipped}`);
  }
  if (!args.dryRun) {
    console.log(`Manifest written to ${config.manifestPath}`);
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((err) => fail(err.message));
}
