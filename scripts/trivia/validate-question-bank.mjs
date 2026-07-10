#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  validateOfficialSourcePolicy,
  validateQuestionCorpus,
} from "../../convex/questionTypes.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));

function parseArgs(argv, cwd) {
  const options = {
    finalGate: false,
    questionsDir: path.join(root, "data/trivia/questions"),
    sourcesFile: path.join(root, "data/trivia/official-sources.json"),
    files: [],
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--final-gate") {
      options.finalGate = true;
    } else if (argument === "--questions-dir") {
      const value = argv[++index];
      if (!value) throw new Error("--questions-dir requires a path");
      options.questionsDir = path.resolve(cwd, value);
    } else if (argument === "--sources") {
      const value = argv[++index];
      if (!value) throw new Error("--sources requires a path");
      options.sourcesFile = path.resolve(cwd, value);
    } else if (argument.startsWith("--")) {
      throw new Error(`Unknown argument: ${argument}`);
    } else {
      options.files.push(path.resolve(cwd, argument));
    }
  }
  return options;
}

function loadJson(file) {
  if (!existsSync(file)) throw new Error(`Missing file: ${file}`);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}: ${error.message}`);
  }
}

function isLegacyBank(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.questions) || data.questions.length === 0) {
    return false;
  }
  return data.questions.every(
    (question) =>
      question &&
      typeof question === "object" &&
      !("format" in question) &&
      (!("source" in question) || typeof question.source === "string"),
  );
}

function displayPath(file, cwd) {
  const relative = path.relative(cwd, file);
  return relative && !relative.startsWith("..") ? relative : file;
}

function printIssues(label, issues, write) {
  if (issues.length === 0) return;
  write(`${label} (${issues.length})`);
  for (const issue of issues) {
    write(`- [${issue.code}] ${issue.path}: ${issue.message}`);
  }
}

function collectFiles(options) {
  if (options.files.length > 0) return options.files;
  if (!existsSync(options.questionsDir)) throw new Error(`Missing directory: ${options.questionsDir}`);
  return readdirSync(options.questionsDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.join(options.questionsDir, file))
    .filter((file) => path.resolve(file) !== path.resolve(options.sourcesFile))
    .sort();
}

export async function runQuestionBankValidator(argv, io = console, cwd = process.cwd()) {
  let options;
  try {
    options = parseArgs(argv, cwd);
  } catch (error) {
    io.error(`Error: ${error.message}`);
    return 1;
  }

  let policy;
  let files;
  try {
    const policyResult = validateOfficialSourcePolicy(loadJson(options.sourcesFile));
    if (!policyResult.value) {
      printIssues("Official-source policy errors", policyResult.errors, (message) => io.error(message));
      return 1;
    }
    policy = policyResult.value;
    files = collectFiles(options);
  } catch (error) {
    io.error(`Error: ${error.message}`);
    return 1;
  }

  const explicitFiles = options.files.length > 0;
  const banks = [];
  const legacyFiles = [];
  try {
    for (const file of files) {
      const data = loadJson(file);
      const display = displayPath(file, cwd);
      if (!explicitFiles && isLegacyBank(data)) {
        legacyFiles.push(display);
      } else {
        banks.push({ file: display, data });
      }
    }
  } catch (error) {
    io.error(`Error: ${error.message}`);
    return 1;
  }

  if (!options.finalGate) {
    for (const file of legacyFiles) io.log(`Legacy bank skipped: ${path.basename(file)}`);
  }

  const report = validateQuestionCorpus(banks, policy, {
    minimumQuestions: options.finalGate ? 460 : undefined,
    requireAllFormats: options.finalGate,
  });
  if (options.finalGate) {
    for (const file of legacyFiles) {
      report.errors.unshift({
        code: "legacy.active_bank",
        path: file,
        message: "Legacy root bank lacks strict format and official provenance and must be retired before final gate.",
      });
    }
  }

  printIssues("Warnings", report.warnings, (message) => io.log(message));
  if (report.errors.length > 0) {
    printIssues("Errors", report.errors, (message) => io.error(message));
    return 1;
  }

  const noun = report.stats.total === 1 ? "question" : "questions";
  io.log(`${report.stats.total} valid ${noun}; ${legacyFiles.length} legacy bank(s) outside the strict set.`);
  return 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const exitCode = await runQuestionBankValidator(process.argv.slice(2));
  process.exitCode = exitCode;
}
