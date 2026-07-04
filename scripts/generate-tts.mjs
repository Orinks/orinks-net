#!/usr/bin/env node
/**
 * Pre-generates host audio for the music trivia roguelite via the ElevenLabs API.
 *
 * Reads data/trivia/barks.json and data/trivia/questions/*.json, generates one MP3
 * per line into public/audio/trivia/, and writes data/trivia/audio-manifest.json
 * mapping line/question IDs to web paths.
 *
 * Idempotent: files are named by a hash of voice + model + settings + text, so
 * unchanged lines are never regenerated. Run it again after credits refresh to
 * pick up where it left off.
 *
 * Usage:
 *   node scripts/generate-tts.mjs --dry-run          # show what would be generated, no API calls
 *   node scripts/generate-tts.mjs                    # generate up to the default 5000-char budget
 *   node scripts/generate-tts.mjs --budget 20000     # custom character budget (0 = unlimited)
 *   node scripts/generate-tts.mjs --only barks       # barks | questions | story
 *   node scripts/generate-tts.mjs --filter gt-00     # only items whose id contains this string
 *
 * Requires ELEVENLABS_API_KEY in the environment or .env.local (never commit it).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_BUDGET = 5000;

function parseArgs(argv) {
  const args = { dryRun: false, budget: DEFAULT_BUDGET, only: null, filter: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--budget") args.budget = Number(argv[++i]);
    else if (arg === "--only") args.only = argv[++i];
    else if (arg === "--filter") args.filter = argv[++i];
    else fail(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(args.budget) || args.budget < 0) fail("--budget must be a non-negative number");
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
function collectItems(config) {
  const items = [];
  const seenIds = new Set();

  function addItem(kind, id, text, voiceName, sourceFile) {
    if (!id || typeof id !== "string") fail(`${sourceFile}: item missing string "id"`);
    if (seenIds.has(id)) fail(`${sourceFile}: duplicate id "${id}"`);
    seenIds.add(id);
    if (!text || typeof text !== "string") fail(`${sourceFile}: item "${id}" missing string text`);
    const voice = config.voices[voiceName];
    if (!voice) fail(`${sourceFile}: item "${id}" references unknown voice "${voiceName}"`);
    items.push({ kind, id, text, voiceName, voice });
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
      addItem("questions", q.id, q.prompt, typeof q.voice === "string" ? q.voice : bankVoice, relPath);
    }
  }

  return items;
}

function audioHash(item, modelId) {
  const input = [item.voice.voiceId, modelId, JSON.stringify(item.voice.settings ?? {}), item.text].join("|");
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
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
    const body = await res.text().catch(() => "");
    throw new Error(`ElevenLabs API ${res.status} for "${item.id}": ${body.slice(0, 500)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function printCreditStatus(config, apiKey) {
  try {
    const res = await fetch(`${config.apiBase}/user/subscription`, { headers: { "xi-api-key": apiKey } });
    if (!res.ok) return;
    const sub = await res.json();
    if (typeof sub.character_count === "number" && typeof sub.character_limit === "number") {
      console.log(`ElevenLabs credits: ${sub.character_count}/${sub.character_limit} characters used this cycle.`);
    }
  } catch {
    // credit status is informational only
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvLocal();

  const config = loadJson("data/trivia/tts.config.json");
  const items = collectItems(config);
  const outputDir = path.join(root, config.outputDir);
  const manifestAbs = path.join(root, config.manifestPath);

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!args.dryRun && !apiKey) {
    fail("ELEVENLABS_API_KEY is not set (add it to .env.local or the environment), or use --dry-run.");
  }
  if (!args.dryRun) await printCreditStatus(config, apiKey);

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

  console.log("");
  console.log(`Already generated: ${stats.existing}`);
  console.log(
    `${args.dryRun ? "Would generate" : "Generated"}: ${stats.generated} (${stats.generatedChars} chars)`,
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

main().catch((err) => fail(err.message));
