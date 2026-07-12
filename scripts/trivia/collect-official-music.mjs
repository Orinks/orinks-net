/**
 * Collects normalized music-related records from official cultural data sources
 * for offline editorial review. It does not generate questions or run at app
 * runtime, and it never writes raw provider responses.
 *
 * Examples:
 *   node scripts/trivia/collect-official-music.mjs --source met --limit 25
 *   node scripts/trivia/collect-official-music.mjs --source loc --limit 3 --preview
 *   node scripts/trivia/collect-official-music.mjs --source smithsonian --input C:\\data\\00.txt --limit 50
 *   node scripts/trivia/collect-official-music.mjs --source unesco --input graph_en.json --output C:\\staging\\unesco.json
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { utcDate } from "./lib/normalize.mjs";
import { collectLoc } from "./sources/loc.mjs";
import { collectMet } from "./sources/met.mjs";
import { collectSmithsonian } from "./sources/smithsonian.mjs";
import { collectUnesco } from "./sources/unesco.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCES = new Set(["loc", "met", "smithsonian", "unesco"]);

const HELP = `Usage:
  node scripts/trivia/collect-official-music.mjs --source <name> [options]

Required:
  --source <name>   loc | met | smithsonian | unesco

Options:
  --limit <count>   Maximum normalized records (default: 25, maximum: 100)
  --input <path>    Local Smithsonian bulk JSON/JSONL/TXT or UNESCO JSON/CSV
  --output <path>   Normalized staging JSON destination
  --preview         Print normalized JSON and do not write a file
  --no-write        Alias for --preview
  --help            Show this help

Smithsonian API access reads SMITHSONIAN_API_KEY. If no key is set, use --input
with a decompressed official bulk JSON file. If UNESCO blocks the download, open
its DIVE data page in a browser and download the JSON or CSV file. Default output
is under the gitignored .cache/trivia/official-music directory.`;

function valueAfter(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

export function parseArgs(argv, { date = utcDate() } = {}) {
  const args = {
    source: "",
    limit: 25,
    input: "",
    output: "",
    preview: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--source") args.source = valueAfter(argv, index++, option).toLowerCase();
    else if (option === "--limit") args.limit = Number(valueAfter(argv, index++, option));
    else if (option === "--input") args.input = valueAfter(argv, index++, option);
    else if (option === "--output") args.output = valueAfter(argv, index++, option);
    else if (option === "--preview" || option === "--no-write") args.preview = true;
    else if (option === "--help" || option === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${option}`);
  }

  if (args.help) return args;
  if (!SOURCES.has(args.source)) {
    throw new Error("--source must be one of: loc, met, smithsonian, unesco");
  }
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100) {
    throw new Error("--limit must be an integer from 1 through 100");
  }
  if (args.input && !["smithsonian", "unesco"].includes(args.source)) {
    throw new Error("--input is supported only for smithsonian and unesco");
  }
  if (!args.output) {
    args.output = path.join(
      ".cache",
      "trivia",
      "official-music",
      `${args.source}-${date}.json`,
    );
  }
  return args;
}

const DEFAULT_COLLECTORS = {
  loc: collectLoc,
  met: collectMet,
  smithsonian: collectSmithsonian,
  unesco: collectUnesco,
};

export async function run(
  args,
  {
    collectors = DEFAULT_COLLECTORS,
    env = process.env,
    now = new Date(),
    stdout = process.stdout,
  } = {},
) {
  const accessedAt = utcDate(now);
  const input = args.input ? path.resolve(process.cwd(), args.input) : undefined;
  const items = await collectors[args.source]({
    limit: args.limit,
    input,
    accessedAt,
    apiKey: env.SMITHSONIAN_API_KEY,
  });
  const staged = {
    schemaVersion: 1,
    source: args.source,
    generatedAt: now.toISOString(),
    accessedAt,
    itemCount: items.length,
    items,
  };
  const json = `${JSON.stringify(staged, null, 2)}\n`;

  if (args.preview) {
    stdout.write(json);
    return { staged, output: null };
  }

  const output = path.isAbsolute(args.output) ? args.output : path.join(ROOT, args.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, json, "utf8");
  return { staged, output };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error.message}\n\n${HELP}`);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    console.log(HELP);
    return;
  }

  try {
    const result = await run(args);
    if (result.output) {
      console.log(`Wrote ${result.staged.itemCount} normalized records to ${result.output}`);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (entry === import.meta.url) void main();
