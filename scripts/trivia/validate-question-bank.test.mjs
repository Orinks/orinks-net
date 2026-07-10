// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runQuestionBankValidator } from "./validate-question-bank.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixtureDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), "midnight-question-validator-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function validQuestion(overrides = {}) {
  return {
    id: "official-0001",
    category: "world-music",
    difficulty: 2,
    format: "world-signal",
    prompt: "Which instrument is identified in this official collection record?",
    choices: ["Kora", "Sitar", "Bandoneon", "Shakuhachi"],
    answer: 0,
    explanation: "The official collection record identifies a kora.",
    source: {
      publisher: "Library of Congress",
      title: "Kora in the Performing Arts Collection",
      url: "https://www.loc.gov/item/official-kora-record/",
      accessedAt: "2026-07-10",
      evidenceSummary: "The item record names the instrument as a kora.",
    },
    ...overrides,
  };
}

function policy() {
  return {
    publishers: [{ publisher: "Library of Congress", hosts: ["www.loc.gov"] }],
  };
}

function capture() {
  const stdout = [];
  const stderr = [];
  return {
    stdout,
    stderr,
    io: {
      log: (message = "") => stdout.push(String(message)),
      error: (message = "") => stderr.push(String(message)),
    },
  };
}

describe("question-bank validator CLI", () => {
  test("strictly validates explicitly selected files", async () => {
    const directory = fixtureDirectory();
    const bank = path.join(directory, "official.json");
    const sources = path.join(directory, "sources.json");
    writeJson(bank, { questions: [validQuestion()] });
    writeJson(sources, policy());
    const output = capture();

    const exitCode = await runQuestionBankValidator(
      ["--sources", sources, bank],
      output.io,
    );

    expect(exitCode).toBe(0);
    expect(output.stdout.join("\n")).toContain("1 valid question");
    expect(output.stderr).toEqual([]);
  });

  test("returns a failure for a hard error while warnings remain non-fatal", async () => {
    const directory = fixtureDirectory();
    const badBank = path.join(directory, "bad.json");
    const warningBank = path.join(directory, "warning.json");
    const sources = path.join(directory, "sources.json");
    writeJson(badBank, { questions: [{ ...validQuestion(), format: "unknown" }] });
    writeJson(sources, policy());
    const badOutput = capture();

    expect(
      await runQuestionBankValidator(["--sources", sources, badBank], badOutput.io),
    ).toBe(1);
    expect(badOutput.stderr.join("\n")).toContain("question.format.invalid");

    const longPrompt = Array.from({ length: 26 }, (_, index) => `word${index}`).join(" ");
    writeJson(warningBank, { questions: [validQuestion({ prompt: `${longPrompt}?` })] });
    const warningOutput = capture();
    expect(
      await runQuestionBankValidator(["--sources", sources, warningBank], warningOutput.io),
    ).toBe(0);
    expect(warningOutput.stdout.join("\n")).toContain("Warnings (1)");
  });

  test("audits legacy banks incrementally but final-gate mode fails them clearly", async () => {
    const directory = fixtureDirectory();
    const sources = path.join(directory, "sources.json");
    writeJson(sources, policy());
    writeJson(path.join(directory, "legacy.json"), {
      questions: [
        {
          id: "legacy-0001",
          category: "rock",
          difficulty: 1,
          prompt: "Which band recorded this song?",
          choices: ["One", "Two", "Three", "Four"],
          answer: 1,
          explanation: "A legacy explanation.",
          source: "community-database",
        },
      ],
    });

    const auditOutput = capture();
    expect(
      await runQuestionBankValidator(
        ["--sources", sources, "--questions-dir", directory],
        auditOutput.io,
      ),
    ).toBe(0);
    expect(auditOutput.stdout.join("\n")).toContain("Legacy bank skipped: legacy.json");

    const finalOutput = capture();
    expect(
      await runQuestionBankValidator(
        ["--final-gate", "--sources", sources, "--questions-dir", directory],
        finalOutput.io,
      ),
    ).toBe(1);
    expect(finalOutput.stderr.join("\n")).toContain("legacy.active_bank");
    expect(finalOutput.stderr.join("\n")).toContain("legacy.json");
  });
});
