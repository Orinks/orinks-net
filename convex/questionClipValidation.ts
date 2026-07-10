import type {
  MysteryClip,
  MysteryClipAttribution,
  QuestionFormat,
  ValidationIssue,
} from "./questionTypes";

const CLIP_KEYS = new Set([
  "id",
  "provider",
  "providerAssetId",
  "startSeconds",
  "durationSeconds",
  "textClue",
  "attribution",
]);
const MEDIA_FORMATS = new Set<QuestionFormat>(["needle-drop", "sound-lab"]);
const PROVIDERS = new Set(["audius", "feed-clips", "remote-open"]);
const CLIP_ID_PATTERN = /^ms-clip-[a-f0-9]{8}$/;
const COMMON_CLUE_WORDS = new Set(["about", "after", "before", "music", "sound", "track"]);

interface MysteryClipQuestionContext {
  format: unknown;
  choices: unknown;
  answer: unknown;
  aliases: unknown;
}

type AttributionValidator = (
  value: unknown,
  path: string,
  errors: ValidationIssue[],
) => value is MysteryClipAttribution;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addIssue(
  issues: ValidationIssue[],
  code: string,
  path: string,
  message: string,
) {
  issues.push({ code, path, message });
}

function nonEmptyString(
  value: unknown,
  code: string,
  path: string,
  errors: ValidationIssue[],
): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    addIssue(errors, code, path, "Expected a non-empty string.");
    return false;
  }
  return true;
}

function leakIdentity(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function answerSecrets(context: MysteryClipQuestionContext) {
  const secrets: string[] = [];
  if (
    Array.isArray(context.choices) &&
    Number.isInteger(context.answer) &&
    typeof context.choices[context.answer as number] === "string"
  ) {
    secrets.push(context.choices[context.answer as number]);
  }
  if (Array.isArray(context.aliases)) {
    secrets.push(...context.aliases.filter((alias): alias is string => typeof alias === "string"));
  }
  return [...new Set(secrets.map(leakIdentity).filter(Boolean))];
}

function validateTextClueSecrecy(
  textClue: string,
  context: MysteryClipQuestionContext,
  path: string,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
) {
  const clue = leakIdentity(textClue);
  const paddedClue = ` ${clue} `;
  const secrets = answerSecrets(context);
  if (secrets.some((secret) => paddedClue.includes(` ${secret} `))) {
    addIssue(
      errors,
      "question.clip.text_clue.answer_leak",
      path,
      "Text clue must not contain the normalized answer or an accepted alias.",
    );
    return;
  }
  const clueTokens = new Set(clue.split(" "));
  const suspicious = secrets.some((secret) =>
    secret
      .split(" ")
      .some((token) => token.length >= 5 && !COMMON_CLUE_WORDS.has(token) && clueTokens.has(token)),
  );
  if (suspicious) {
    addIssue(
      warnings,
      "question.clip.text_clue.answer_overlap",
      path,
      "Text clue shares a distinctive answer word and needs editorial leakage review.",
    );
  }
}

export function validateMysteryClip(
  value: unknown,
  context: MysteryClipQuestionContext,
  path: string,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
  validateAttribution: AttributionValidator,
): value is MysteryClip {
  if (!isRecord(value)) {
    addIssue(errors, "question.clip.object", path, "Clip metadata must be a complete object.");
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!CLIP_KEYS.has(key)) {
      addIssue(errors, "question.field.unknown", `${path}.${key}`, `Unknown field "${key}".`);
    }
  }
  if (!MEDIA_FORMATS.has(context.format as QuestionFormat)) {
    addIssue(
      errors,
      "question.clip.format",
      path,
      "Mystery clips are only valid for needle-drop and sound-lab questions.",
    );
  }
  if (
    !nonEmptyString(value.id, "question.clip.id", `${path}.id`, errors) ||
    !CLIP_ID_PATTERN.test(value.id)
  ) {
    if (typeof value.id === "string" && value.id.trim() && !CLIP_ID_PATTERN.test(value.id)) {
      addIssue(
        errors,
        "question.clip.id.opaque",
        `${path}.id`,
        "Clip ID must use a nonsemantic ms-clip plus eight-hex token.",
      );
    }
  }
  if (typeof value.provider !== "string" || !PROVIDERS.has(value.provider)) {
    addIssue(errors, "question.clip.provider", `${path}.provider`, "Clip provider is not supported.");
  }
  nonEmptyString(
    value.providerAssetId,
    "question.clip.provider_asset_id",
    `${path}.providerAssetId`,
    errors,
  );
  if (
    typeof value.startSeconds !== "number" ||
    !Number.isFinite(value.startSeconds) ||
    value.startSeconds < 0
  ) {
    addIssue(
      errors,
      "question.clip.start",
      `${path}.startSeconds`,
      "Clip start must be a finite non-negative number.",
    );
  }
  if (
    typeof value.durationSeconds !== "number" ||
    !Number.isFinite(value.durationSeconds) ||
    value.durationSeconds < 10 ||
    value.durationSeconds > 15
  ) {
    addIssue(
      errors,
      "question.clip.duration",
      `${path}.durationSeconds`,
      "Clip duration must be between 10 and 15 seconds.",
    );
  }
  if (nonEmptyString(value.textClue, "question.clip.text_clue", `${path}.textClue`, errors)) {
    if (value.textClue !== value.textClue.normalize("NFC")) {
      addIssue(errors, "question.text.nfc", `${path}.textClue`, "Text must use Unicode NFC normalization.");
    }
    validateTextClueSecrecy(value.textClue, context, `${path}.textClue`, errors, warnings);
  }
  validateAttribution(value.attribution, `${path}.attribution`, errors);
  return true;
}
