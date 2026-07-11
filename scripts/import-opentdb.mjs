#!/usr/bin/env node
/**
 * Imports music trivia questions from the Open Trivia Database (opentdb.com)
 * into the question bank format used by data/trivia/questions/.
 *
 * OpenTDB is free, keyless, and licensed CC BY-SA 4.0 — the site must credit
 * it (see the source/license fields written into the output file). Questions
 * are user-contributed, so give the imported file a curation pass before
 * syncing it to Convex: fix typos, drop weak questions, adjust difficulty.
 *
 * Idempotent: questions are deduplicated against every file in
 * data/trivia/questions/ by id and by normalized prompt text, so re-running
 * only appends new questions.
 *
 * Usage:
 *   node scripts/import-opentdb.mjs                     # import up to 100 questions
 *   node scripts/import-opentdb.mjs --amount 300        # bigger haul (50 per API call, 5s apart)
 *   node scripts/import-opentdb.mjs --difficulty easy   # easy | medium | hard
 *   node scripts/import-opentdb.mjs --out data/trivia/questions/opentdb-music.json
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const API_BASE = "https://opentdb.com";
const MUSIC_CATEGORY = 12;
const BATCH_SIZE = 50; // OpenTDB max per request
const RATE_LIMIT_MS = 5500; // OpenTDB allows one request per 5 seconds
const DIFFICULTY_MAP = { easy: 1, medium: 3, hard: 5 };

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    amount: 100,
    difficulty: null,
    out: "data/trivia/questions/opentdb-music.json",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--amount") args.amount = Number(argv[++i]);
    else if (arg === "--difficulty") args.difficulty = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else fail(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(args.amount) || args.amount < 1) fail("--amount must be a positive integer");
  if (args.difficulty && !(args.difficulty in DIFFICULTY_MAP)) {
    fail("--difficulty must be easy, medium, or hard");
  }
  return args;
}

function decode(value) {
  return Buffer.from(value, "base64").toString("utf8");
}

function normalizePrompt(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
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

async function apiGet(pathname) {
  const res = await fetch(`${API_BASE}${pathname}`);
  if (!res.ok) throw new Error(`OpenTDB HTTP ${res.status} for ${pathname}`);
  return res.json();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outAbs = path.join(root, args.out);
  const existing = loadExisting();

  // A session token stops OpenTDB from returning questions we already saw this session.
  const tokenRes = await apiGet("/api_token.php?command=request");
  if (tokenRes.response_code !== 0) fail("Could not get an OpenTDB session token.");
  const token = tokenRes.token;

  const imported = [];
  let duplicates = 0;
  let remaining = args.amount;
  let exhausted = false;

  while (remaining > 0 && !exhausted) {
    const batch = Math.min(BATCH_SIZE, remaining);
    const params = new URLSearchParams({
      amount: String(batch),
      category: String(MUSIC_CATEGORY),
      type: "multiple",
      encode: "base64",
      token,
    });
    if (args.difficulty) params.set("difficulty", args.difficulty);

    const data = await apiGet(`/api.php?${params}`);
    if (data.response_code === 4) {
      // Token exhausted: we've seen every question matching this query.
      exhausted = true;
    } else if (data.response_code === 1) {
      console.log("OpenTDB has fewer questions than requested for this query; stopping.");
      exhausted = true;
    } else if (data.response_code === 5) {
      console.log("Rate limited; waiting before retrying...");
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS));
      continue;
    } else if (data.response_code !== 0) {
      fail(`OpenTDB returned response_code ${data.response_code}`);
    }

    for (const raw of data.results ?? []) {
      const prompt = decode(raw.question).trim();
      const correct = decode(raw.correct_answer).trim();
      const incorrect = raw.incorrect_answers.map((a) => decode(a).trim());
      const difficulty = decode(raw.difficulty);
      const id = `otdb-${createHash("sha256").update(prompt).digest("hex").slice(0, 8)}`;
      const promptKey = normalizePrompt(prompt);

      if (existing.ids.has(id) || existing.prompts.has(promptKey)) {
        duplicates++;
        continue;
      }
      existing.ids.add(id);
      existing.prompts.add(promptKey);

      const choices = shuffle([correct, ...incorrect]);
      imported.push({
        id,
        category: "music",
        difficulty: DIFFICULTY_MAP[difficulty] ?? 3,
        prompt,
        choices,
        answer: choices.indexOf(correct),
        source: "opentdb",
      });
    }

    remaining -= batch;
    console.log(`Fetched ${data.results?.length ?? 0} questions (${imported.length} new so far)...`);
    if (remaining > 0 && !exhausted) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS));
    }
  }

  const bank = existsSync(outAbs)
    ? JSON.parse(readFileSync(outAbs, "utf8"))
    : {
        minigame: "general-trivia",
        voice: "clide",
        source: "Open Trivia Database (https://opentdb.com)",
        license: "CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)",
        curated: false,
        questions: [],
      };
  bank.questions.push(...imported);
  writeFileSync(outAbs, `${JSON.stringify(bank, null, 2)}\n`);

  console.log("");
  console.log(`Imported ${imported.length} new questions into ${args.out}`);
  if (duplicates > 0) console.log(`Skipped ${duplicates} duplicates already in the bank.`);
  console.log(`Total in file: ${bank.questions.length}`);
  console.log("Reminder: curate before syncing to Convex, and credit OpenTDB on the site (CC BY-SA 4.0).");
}

main().catch((err) => fail(err.message));
