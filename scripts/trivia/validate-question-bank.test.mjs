// @vitest-environment node

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const validatorPath = fileURLToPath(new URL("./validate-question-bank.mjs", import.meta.url));

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
    prompt: "Which West African instrument has twenty-one strings and a calabash body?",
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

function runValidator(args) {
  const result = spawnSync(process.execPath, ["--no-warnings", validatorPath, ...args], {
    encoding: "utf8",
  });
  return {
    exitCode: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

describe("question-bank validator CLI", () => {
  test("strictly validates explicitly selected files", async () => {
    const directory = fixtureDirectory();
    const bank = path.join(directory, "official.json");
    const sources = path.join(directory, "sources.json");
    writeJson(bank, { questions: [validQuestion()] });
    writeJson(sources, policy());
    const output = runValidator(["--sources", sources, bank]);

    expect(output.exitCode).toBe(0);
    expect(output.stdout).toContain("1 valid question");
    expect(output.stderr).toBe("");
  });

  test("returns a failure for a hard error while warnings remain non-fatal", async () => {
    const directory = fixtureDirectory();
    const badBank = path.join(directory, "bad.json");
    const warningBank = path.join(directory, "warning.json");
    const sources = path.join(directory, "sources.json");
    writeJson(badBank, { questions: [{ ...validQuestion(), format: "unknown" }] });
    writeJson(sources, policy());
    const badOutput = runValidator(["--sources", sources, badBank]);

    expect(badOutput.exitCode).toBe(1);
    expect(badOutput.stderr).toContain("question.format.invalid");

    const longPrompt = Array.from({ length: 26 }, (_, index) => `word${index}`).join(" ");
    writeJson(warningBank, { questions: [validQuestion({ prompt: `${longPrompt}?` })] });
    const warningOutput = runValidator(["--sources", sources, warningBank]);
    expect(warningOutput.exitCode).toBe(0);
    expect(warningOutput.stdout).toContain("Warnings (1)");
  });

  test("preserves legacy banks outside the strict official-source gate", async () => {
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

    const auditOutput = runValidator([
      "--sources",
      sources,
      "--questions-dir",
      directory,
    ]);
    expect(auditOutput.exitCode).toBe(0);
    expect(auditOutput.stdout).toContain(
      "Legacy bank preserved outside strict provenance validation: legacy.json",
    );

    const finalOutput = runValidator([
      "--final-gate",
      "--sources",
      sources,
      "--questions-dir",
      directory,
    ]);
    expect(finalOutput.exitCode).toBe(1);
    expect(finalOutput.stderr).toContain("corpus.count.minimum");
    expect(finalOutput.stderr).not.toContain("legacy.active_bank");
    expect(finalOutput.stdout).toContain("legacy.json");
  });

  test("rejects source-record framing in strict banks", () => {
    const directory = fixtureDirectory();
    const bank = path.join(directory, "official.json");
    const sources = path.join(directory, "sources.json");
    writeJson(bank, {
      questions: [
        validQuestion({
          prompt: "Which composer appears in the Library of Congress contributor list for Swanee?",
        }),
      ],
    });
    writeJson(sources, policy());

    const output = runValidator(["--sources", sources, bank]);
    expect(output.exitCode).toBe(1);
    expect(output.stderr).toContain("question.prompt.source_record_framing");
  });
});
