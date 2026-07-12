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

function pronunciationEntries(pronunciation) {
  if (pronunciation === undefined) return [];
  if (
    pronunciation === null ||
    typeof pronunciation !== "object" ||
    Array.isArray(pronunciation)
  ) {
    throw new Error("Pronunciation guidance must be an object of literal text and aliases.");
  }
  const entries = Object.entries(pronunciation);
  for (const [visibleText, alias] of entries) {
    if (
      typeof visibleText !== "string" ||
      visibleText.trim().length === 0 ||
      typeof alias !== "string" ||
      alias.trim().length === 0
    ) {
      throw new Error("Pronunciation guidance requires non-empty string aliases.");
    }
  }
  return entries;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function applyPronunciationAliases(text, pronunciation) {
  if (typeof text !== "string") {
    throw new Error("Pronunciation aliases require narration text.");
  }
  const entries = pronunciationEntries(pronunciation);
  if (entries.length === 0) return text;
  for (const [visibleText] of entries) {
    if (!text.includes(visibleText)) {
      throw new Error(`Pronunciation term "${visibleText}" does not appear in the narration.`);
    }
  }
  const longestFirst = entries.toSorted(([left], [right]) => {
    const lengthDifference = right.length - left.length;
    if (lengthDifference !== 0) return lengthDifference;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const aliases = new Map(longestFirst);
  const literalPattern = new RegExp(
    longestFirst.map(([visibleText]) => escapeRegExp(visibleText)).join("|"),
    "gu",
  );
  return text.replace(literalPattern, (visibleText) => aliases.get(visibleText));
}

export function buildQuestionAudioPlan(question) {
  const displayText = buildQuestionNarration(question);
  return {
    displayText,
    text: applyPronunciationAliases(displayText, question.pronunciation),
    pronunciation: question.pronunciation,
  };
}

export function audioHash(item, modelId) {
  const input = [
    item.voice.voiceId,
    modelId,
    JSON.stringify(item.voice.settings ?? {}),
    item.text,
  ];
  return createHash("sha256").update(input.join("|")).digest("hex").slice(0, 16);
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
