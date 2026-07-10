import { createHash } from "node:crypto";

export function buildQuestionNarration(question) {
  if (typeof question?.prompt !== "string" || !Array.isArray(question.choices)) {
    throw new Error("Question narration requires a prompt and choices.");
  }
  const choiceText = question.choices
    .map((choice, index) => `${index + 1}: ${choice}`)
    .join(". ");
  return `${question.prompt} Your choices are... ${choiceText}.`;
}

export function audioHash(item, modelId) {
  const input = [
    item.voice.voiceId,
    modelId,
    JSON.stringify(item.voice.settings ?? {}),
    item.text,
  ].join("|");
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function validateGenerationBudget({ dryRun, budget }) {
  if (!Number.isFinite(budget) || budget < 0) {
    throw new Error("--budget must be a non-negative number.");
  }
  if (!dryRun && budget === 0) {
    throw new Error("Live generation requires an explicit positive --budget ceiling.");
  }
}

export function assertSafeGenerationBudget({
  requestedCharacters,
  creditMultiplier,
  remainingCredits,
  reserveCredits,
}) {
  for (const [name, value] of Object.entries({
    requestedCharacters,
    creditMultiplier,
    remainingCredits,
    reserveCredits,
  })) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} must be a finite non-negative number.`);
    }
  }
  const requestedCredits = Math.ceil(requestedCharacters * creditMultiplier);
  const usableCredits = Math.max(0, Math.floor(remainingCredits - reserveCredits));
  if (requestedCredits > usableCredits) {
    throw new Error(
      `Requested generation would exceed the safe remaining allowance ` +
        `(${requestedCredits} requested credits; ${usableCredits} usable).`,
    );
  }
  return { requestedCredits, usableCredits };
}

export function verifyAudioManifest({
  expected,
  manifest,
  fileSize,
  minimumBytes = 1_024,
}) {
  const report = { valid: [], missing: [], stale: [], tooSmall: [], unknown: [] };
  const expectedIds = new Set(expected.map((item) => item.id));
  for (const item of expected) {
    const actualPath = manifest[item.id];
    if (!actualPath) {
      report.missing.push(item.id);
      continue;
    }
    if (actualPath !== item.webPath) {
      report.stale.push(item.id);
      continue;
    }
    const size = fileSize(actualPath);
    if (typeof size !== "number" || size < minimumBytes) {
      report.tooSmall.push(item.id);
      continue;
    }
    report.valid.push(item.id);
  }
  for (const id of Object.keys(manifest)) {
    if (!expectedIds.has(id)) report.unknown.push(id);
  }
  return report;
}
