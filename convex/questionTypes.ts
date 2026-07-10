import { validateMysteryClip } from "./questionClipValidation.ts";

export const QUESTION_FORMATS = [
  "award-desk",
  "chart-wire",
  "world-signal",
  "instrument-detective",
  "studio-lab",
  "night-timeline",
  "archive-clue",
  "odd-one-out",
  "needle-drop",
  "sound-lab",
] as const;

export type QuestionFormat = (typeof QUESTION_FORMATS)[number];
export type QuestionDifficulty = 1 | 2 | 3 | 4 | 5;
export type QuestionAnswerIndex = 0 | 1 | 2 | 3;
export type QuestionChoices = [string, string, string, string];

export interface QuestionSource {
  publisher: string;
  title: string;
  url: string;
  accessedAt: string;
  evidenceSummary: string;
}

export interface MysteryClipAttribution {
  creator: string;
  copyrightNotice: string;
  licenseTitle: string;
  licenseUrl: string;
  sourceTitle: string;
  sourceUrl: string;
}

/** Server-only metadata. Only the opaque ID and text clue are public before an answer. */
export interface MysteryClip {
  id: string;
  provider: "audius" | "feed-clips" | "remote-open";
  providerAssetId: string;
  startSeconds: number;
  durationSeconds: number;
  textClue: string;
  attribution: MysteryClipAttribution;
}

/** The complete authored record. This type must stay on the server/editorial side. */
export interface PrivateQuestion {
  id: string;
  category: string;
  difficulty: QuestionDifficulty;
  format: QuestionFormat;
  prompt: string;
  choices: QuestionChoices;
  answer: QuestionAnswerIndex;
  explanation: string;
  source: QuestionSource;
  aliases?: string[];
  pronunciation?: Record<string, string>;
  clip?: MysteryClip;
  voice?: string | false;
}

export type AuthoredQuestion = PrivateQuestion;

export interface PublicQuestionClip {
  id: string;
  textClue: string;
}

/** Exact pre-answer payload. It intentionally cannot represent private fields. */
export interface PublicQuestion {
  key: string;
  category: string;
  difficulty: QuestionDifficulty;
  format: QuestionFormat;
  prompt: string;
  choices: QuestionChoices;
  clip: PublicQuestionClip | null;
}

export type QuestionSourceDisclosure = Pick<QuestionSource, "publisher" | "title" | "url">;

/** Safe provenance and licensing details revealed only after answer resolution. */
export interface AnswerDisclosure {
  source: QuestionSourceDisclosure;
  clipAttribution: MysteryClipAttribution | null;
}

export interface OfficialPublisherPolicy {
  publisher: string;
  /** Exact lowercase hosts. Subdomains are not implicit. */
  hosts: readonly string[];
}

export interface OfficialSourcePolicy {
  publishers: readonly OfficialPublisherPolicy[];
}

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface ValidationResult<T> {
  value: T | null;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface QuestionBankInput {
  file: string;
  data: unknown;
}

export interface QuestionCorpusStats {
  total: number;
  categories: Record<string, number>;
  formats: Record<string, number>;
  difficulties: Record<string, number>;
  publishers: Record<string, number>;
  sourceUrls: Record<string, number>;
}

export interface CorpusValidationOptions {
  minimumQuestions?: number;
  requireAllFormats?: boolean;
}

export interface CorpusValidationResult {
  questions: PrivateQuestion[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  stats: QuestionCorpusStats;
}

const FORMAT_SET = new Set<string>(QUESTION_FORMATS);
const QUESTION_KEYS = new Set([
  "id",
  "category",
  "difficulty",
  "format",
  "prompt",
  "choices",
  "answer",
  "explanation",
  "source",
  "aliases",
  "pronunciation",
  "clip",
  "voice",
]);
const SOURCE_KEYS = new Set(["publisher", "title", "url", "accessedAt", "evidenceSummary"]);
const ATTRIBUTION_KEYS = new Set([
  "creator",
  "copyrightNotice",
  "licenseTitle",
  "licenseUrl",
  "sourceTitle",
  "sourceUrl",
]);
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CATCH_ALL_CHOICE = /^(?:all|none) of (?:the )?(?:above|these)$/i;
const EXACT_HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

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

function validateKnownKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  errors: ValidationIssue[],
) {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      addIssue(errors, "question.field.unknown", `${path}.${key}`, `Unknown field "${key}".`);
    }
  }
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

function validateNfc(value: string, path: string, errors: ValidationIssue[]) {
  if (value !== value.normalize("NFC")) {
    addIssue(errors, "question.text.nfc", path, "Text must use Unicode NFC normalization.");
  }
}

function normalizedIdentity(value: string) {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function strictCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseHttpsUrl(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
  code: string,
): URL | null {
  if (!nonEmptyString(value, code, path, errors)) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      addIssue(errors, code, path, "URL must use HTTPS.");
      return parsed;
    }
    return parsed;
  } catch {
    addIssue(errors, code, path, "Expected a valid absolute URL.");
    return null;
  }
}

export function validateOfficialSourcePolicy(
  value: unknown,
): ValidationResult<OfficialSourcePolicy> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  if (!isRecord(value) || !Array.isArray(value.publishers)) {
    addIssue(
      errors,
      "official_sources.publishers.array",
      "official-sources.publishers",
      "Official-source policy must contain a publishers array.",
    );
    return { value: null, errors, warnings };
  }
  if (value.publishers.length === 0) {
    addIssue(
      errors,
      "official_sources.publishers.empty",
      "official-sources.publishers",
      "Official-source policy must name at least one publisher.",
    );
  }

  const publishers = new Set<string>();
  const hosts = new Map<string, string>();
  value.publishers.forEach((entry, publisherIndex) => {
    const entryPath = `official-sources.publishers[${publisherIndex}]`;
    if (!isRecord(entry)) {
      addIssue(
        errors,
        "official_sources.publisher.object",
        entryPath,
        "Publisher policy must be an object.",
      );
      return;
    }
    for (const key of Object.keys(entry)) {
      if (key !== "publisher" && key !== "hosts") {
        addIssue(
          errors,
          "official_sources.field.unknown",
          `${entryPath}.${key}`,
          `Unknown official-source policy field "${key}".`,
        );
      }
    }
    const publisher = entry.publisher;
    if (
      nonEmptyString(
        publisher,
        "official_sources.publisher.required",
        `${entryPath}.publisher`,
        errors,
      )
    ) {
      validateNfc(publisher, `${entryPath}.publisher`, errors);
      if (publishers.has(publisher)) {
        addIssue(
          errors,
          "official_sources.publisher.duplicate",
          `${entryPath}.publisher`,
          `Publisher "${publisher}" is listed more than once.`,
        );
      }
      publishers.add(publisher);
    }

    if (!Array.isArray(entry.hosts) || entry.hosts.length === 0) {
      addIssue(
        errors,
        "official_sources.hosts.array",
        `${entryPath}.hosts`,
        "Publisher policy must contain at least one exact host.",
      );
      return;
    }
    const publisherHosts = new Set<string>();
    entry.hosts.forEach((host, hostIndex) => {
      const hostPath = `${entryPath}.hosts[${hostIndex}]`;
      if (!nonEmptyString(host, "official_sources.host.required", hostPath, errors)) return;
      if (host !== host.toLocaleLowerCase("en-US") || !EXACT_HOST_PATTERN.test(host)) {
        addIssue(
          errors,
          "official_sources.host.exact",
          hostPath,
          "Hosts must be exact lowercase hostnames without protocols, paths, or wildcards.",
        );
        return;
      }
      if (publisherHosts.has(host)) {
        addIssue(
          errors,
          "official_sources.host.duplicate",
          hostPath,
          `Host "${host}" is duplicated for this publisher.`,
        );
      }
      publisherHosts.add(host);
      const previousPublisher = hosts.get(host);
      if (previousPublisher && previousPublisher !== publisher) {
        addIssue(
          errors,
          "official_sources.host.ambiguous",
          hostPath,
          `Host "${host}" is already assigned to ${previousPublisher}.`,
        );
      } else if (typeof publisher === "string") {
        hosts.set(host, publisher);
      }
    });
  });

  return {
    value: errors.length === 0 ? (value as unknown as OfficialSourcePolicy) : null,
    errors,
    warnings,
  };
}

function validateQuestionSource(
  value: unknown,
  policy: OfficialSourcePolicy,
  path: string,
  errors: ValidationIssue[],
): value is QuestionSource {
  if (!isRecord(value)) {
    addIssue(errors, "question.source.object", path, "Source must be a complete provenance object.");
    return false;
  }
  validateKnownKeys(value, SOURCE_KEYS, path, errors);

  const stringFields = ["publisher", "title", "evidenceSummary"] as const;
  for (const field of stringFields) {
    if (nonEmptyString(value[field], `question.source.${field}`, `${path}.${field}`, errors)) {
      validateNfc(value[field], `${path}.${field}`, errors);
    }
  }

  const accessedAt = value.accessedAt;
  if (
    !nonEmptyString(
      accessedAt,
      "question.source.accessed_at",
      `${path}.accessedAt`,
      errors,
    ) ||
    !strictCalendarDate(accessedAt)
  ) {
    if (typeof accessedAt === "string" && accessedAt.trim().length > 0) {
      addIssue(
        errors,
        "question.source.accessed_at",
        `${path}.accessedAt`,
        "Access date must be a real calendar date in YYYY-MM-DD form.",
      );
    }
  }

  const publisher = typeof value.publisher === "string" ? value.publisher : "";
  const publisherPolicy = policy.publishers.find((entry) => entry.publisher === publisher);
  if (!publisherPolicy) {
    addIssue(
      errors,
      "question.source.publisher",
      `${path}.publisher`,
      `Publisher "${publisher}" is not in the official-source policy.`,
    );
  }

  const url = parseHttpsUrl(
    value.url,
    `${path}.url`,
    errors,
    "question.source.url.invalid",
  );
  if (url) {
    if (url.protocol !== "https:") {
      addIssue(errors, "question.source.url.https", `${path}.url`, "Source URL must use HTTPS.");
    }
    if (
      publisherPolicy &&
      !publisherPolicy.hosts.some((host) => host.toLocaleLowerCase("en-US") === url.hostname.toLocaleLowerCase("en-US"))
    ) {
      addIssue(
        errors,
        "question.source.url.host",
        `${path}.url`,
        `Host "${url.hostname}" is not approved for ${publisherPolicy.publisher}.`,
      );
    }
    if (url.pathname === "/" || url.pathname === "") {
      addIssue(
        errors,
        "question.source.url.generic",
        `${path}.url`,
        "Source URL must point beyond a generic homepage.",
      );
    }
    let decodedPath = url.pathname;
    try {
      decodedPath = decodeURIComponent(url.pathname);
    } catch {
      // Leave malformed escapes to URL and host validation; they cannot match
      // the one exact item-route exception below.
    }
    const isMetNumericItem =
      publisherPolicy?.publisher === "The Metropolitan Museum of Art" &&
      /^\/art\/collection\/search\/\d+\/?$/.test(url.pathname);
    const isSearchPath = /\/(?:search|find)(?:\/|$)/i.test(decodedPath);
    const isSearchQuery = ["q", "query", "search"].some((key) => url.searchParams.has(key));
    if ((isSearchPath && !isMetNumericItem) || isSearchQuery) {
      addIssue(
        errors,
        "question.source.url.search",
        `${path}.url`,
        "Source URL must not be a search-results page.",
      );
    }
  }

  return true;
}

function validateAttribution(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
): value is MysteryClipAttribution {
  if (!isRecord(value)) {
    addIssue(
      errors,
      "question.clip.attribution.object",
      path,
      "Clip attribution must be a complete object.",
    );
    return false;
  }
  validateKnownKeys(value, ATTRIBUTION_KEYS, path, errors);
  for (const field of ["creator", "copyrightNotice", "licenseTitle", "sourceTitle"] as const) {
    if (nonEmptyString(value[field], "question.clip.attribution.text", `${path}.${field}`, errors)) {
      validateNfc(value[field], `${path}.${field}`, errors);
    }
  }
  for (const field of ["licenseUrl", "sourceUrl"] as const) {
    const parsed = parseHttpsUrl(
      value[field],
      `${path}.${field}`,
      errors,
      "question.clip.attribution.url",
    );
    if (parsed && parsed.protocol !== "https:") {
      addIssue(
        errors,
        "question.clip.attribution.url",
        `${path}.${field}`,
        "Attribution URLs must use HTTPS.",
      );
    }
  }
  return true;
}

function validateAliases(value: unknown, path: string, errors: ValidationIssue[]) {
  if (!Array.isArray(value)) {
    addIssue(errors, "question.aliases.array", path, "Aliases must be an array of strings.");
    return;
  }
  const seen = new Set<string>();
  value.forEach((alias, index) => {
    const aliasPath = `${path}[${index}]`;
    if (!nonEmptyString(alias, "question.aliases.text", aliasPath, errors)) return;
    validateNfc(alias, aliasPath, errors);
    const normalized = normalizedIdentity(alias);
    if (seen.has(normalized)) {
      addIssue(errors, "question.aliases.duplicate", aliasPath, "Aliases must be distinct.");
    }
    seen.add(normalized);
  });
}

function validatePronunciation(
  value: unknown,
  path: string,
  narrationText: string,
  errors: ValidationIssue[],
) {
  if (!isRecord(value)) {
    addIssue(
      errors,
      "question.pronunciation.object",
      path,
      "Pronunciation metadata must be a string-to-string object.",
    );
    return;
  }
  for (const [term, pronunciation] of Object.entries(value)) {
    if (term.trim().length === 0) {
      addIssue(errors, "question.pronunciation.term", path, "Pronunciation terms cannot be empty.");
    } else {
      validateNfc(term, path, errors);
      if (!narrationText.includes(term)) {
        addIssue(
          errors,
          "question.pronunciation.unused",
          `${path}.${term}`,
          "Pronunciation terms must appear in the narrated prompt or choices.",
        );
      }
    }
    if (
      nonEmptyString(
        pronunciation,
        "question.pronunciation.value",
        `${path}.${term}`,
        errors,
      )
    ) {
      validateNfc(pronunciation, `${path}.${term}`, errors);
    }
  }
}
function hasPronunciationSensitiveUnicode(text: string): boolean {
  return [...text].some(
    (character) =>
      character.codePointAt(0)! > 0x7f && /[\p{L}\p{N}\p{S}]/u.test(character),
  );
}

export function validateQuestion(
  value: unknown,
  policy: OfficialSourcePolicy,
  path = "question",
): ValidationResult<PrivateQuestion> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  if (!isRecord(value)) {
    addIssue(errors, "question.object", path, "Question must be an object.");
    return { value: null, errors, warnings };
  }
  validateKnownKeys(value, QUESTION_KEYS, path, errors);

  if (!nonEmptyString(value.id, "question.id.required", `${path}.id`, errors) || !ID_PATTERN.test(value.id)) {
    if (typeof value.id === "string" && value.id.trim().length > 0 && !ID_PATTERN.test(value.id)) {
      addIssue(errors, "question.id.format", `${path}.id`, "ID must be lowercase kebab-case.");
    }
  }
  if (nonEmptyString(value.category, "question.category.required", `${path}.category`, errors)) {
    validateNfc(value.category, `${path}.category`, errors);
  }
  if (
    !Number.isInteger(value.difficulty) ||
    (value.difficulty as number) < 1 ||
    (value.difficulty as number) > 5
  ) {
    addIssue(
      errors,
      "question.difficulty.invalid",
      `${path}.difficulty`,
      "Difficulty must be an integer from 1 through 5.",
    );
  }
  if (typeof value.format !== "string" || !FORMAT_SET.has(value.format)) {
    addIssue(
      errors,
      "question.format.invalid",
      `${path}.format`,
      "Format must be one of the ten approved broadcast formats.",
    );
  }
  if (nonEmptyString(value.prompt, "question.prompt.required", `${path}.prompt`, errors)) {
    validateNfc(value.prompt, `${path}.prompt`, errors);
    const wordCount = value.prompt.trim().split(/\s+/).length;
    if (wordCount > 25) {
      addIssue(
        warnings,
        "question.prompt.long",
        `${path}.prompt`,
        `Prompt has ${wordCount} words; editorial review is required above 25.`,
      );
    }
    if (/\b(?:not|except|least|incorrect|false)\b/i.test(value.prompt)) {
      addIssue(
        warnings,
        "question.prompt.negative",
        `${path}.prompt`,
        "Negative or trick wording requires editorial review.",
      );
    }
  }

  if (!Array.isArray(value.choices) || value.choices.length !== 4) {
    addIssue(
      errors,
      "question.choices.count",
      `${path}.choices`,
      "Questions must have exactly four choices.",
    );
  } else {
    const seenChoices = new Set<string>();
    const lengths: number[] = [];
    value.choices.forEach((choice, index) => {
      const choicePath = `${path}.choices[${index}]`;
      if (!nonEmptyString(choice, "question.choices.text", choicePath, errors)) return;
      validateNfc(choice, choicePath, errors);
      const normalized = normalizedIdentity(choice);
      if (seenChoices.has(normalized)) {
        addIssue(errors, "question.choices.duplicate", choicePath, "Choices must be distinct.");
      }
      seenChoices.add(normalized);
      lengths.push(choice.trim().length);
      if (CATCH_ALL_CHOICE.test(choice.trim())) {
        addIssue(
          errors,
          "question.choices.catch_all",
          choicePath,
          "All-of-the-above and none-of-the-above choices are not allowed.",
        );
      }
    });
    if (lengths.length === 4) {
      const sorted = [...lengths].sort((a, b) => a - b);
      const median = (sorted[1] + sorted[2]) / 2;
      if (median > 0 && sorted[3] > median * 2) {
        addIssue(
          warnings,
          "question.choices.imbalance",
          `${path}.choices`,
          "The longest choice is more than twice the median choice length.",
        );
      }
    }
  }

  if (!Number.isInteger(value.answer) || (value.answer as number) < 0 || (value.answer as number) > 3) {
    addIssue(
      errors,
      "question.answer.invalid",
      `${path}.answer`,
      "Answer must be an integer from 0 through 3.",
    );
  }
  if (nonEmptyString(value.explanation, "question.explanation.required", `${path}.explanation`, errors)) {
    validateNfc(value.explanation, `${path}.explanation`, errors);
  }
  validateQuestionSource(value.source, policy, `${path}.source`, errors);

  const visibleText = [
    typeof value.prompt === "string" ? value.prompt : "",
    ...(Array.isArray(value.choices)
      ? value.choices.filter((choice): choice is string => typeof choice === "string")
      : []),
  ].join(" ");
  if (value.aliases !== undefined) validateAliases(value.aliases, `${path}.aliases`, errors);
  if (value.pronunciation !== undefined) {
    validatePronunciation(value.pronunciation, `${path}.pronunciation`, visibleText, errors);
  }
  if (value.clip !== undefined) {
    validateMysteryClip(
      value.clip,
      { format: value.format, choices: value.choices, answer: value.answer, aliases: value.aliases },
      `${path}.clip`,
      errors,
      warnings,
      validateAttribution,
    );
  }
  if (
    value.voice !== undefined &&
    value.voice !== false &&
    (typeof value.voice !== "string" || value.voice.trim().length === 0)
  ) {
    addIssue(
      errors,
      "question.voice.invalid",
      `${path}.voice`,
      "Voice must be a non-empty voice name or false.",
    );
  }

  if (
    hasPronunciationSensitiveUnicode(visibleText) &&
    value.pronunciation === undefined
  ) {
    addIssue(
      warnings,
      "question.pronunciation.review",
      path,
      "Non-ASCII visible text requires pronunciation review.",
    );
  }

  return {
    value: errors.length === 0 ? (value as unknown as PrivateQuestion) : null,
    errors,
    warnings,
  };
}

function increment(record: Record<string, number>, key: string) {
  record[key] = (record[key] ?? 0) + 1;
}

function emptyStats(): QuestionCorpusStats {
  return {
    total: 0,
    categories: {},
    formats: {},
    difficulties: {},
    publishers: {},
    sourceUrls: {},
  };
}

export function validateQuestionCorpus(
  banks: readonly QuestionBankInput[],
  policy: OfficialSourcePolicy,
  options: CorpusValidationOptions = {},
): CorpusValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const questions: PrivateQuestion[] = [];
  const ids = new Map<string, string>();
  const prompts = new Map<string, string>();
  const clipIds = new Map<string, string>();

  for (const bank of banks) {
    if (!isRecord(bank.data) || !Array.isArray(bank.data.questions)) {
      addIssue(
        errors,
        "bank.questions.array",
        bank.file,
        "Question bank must contain a questions array.",
      );
      continue;
    }
    bank.data.questions.forEach((rawQuestion, index) => {
      const questionPath = `${bank.file}.questions[${index}]`;
      const result = validateQuestion(rawQuestion, policy, questionPath);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
      if (!result.value) return;
      const question = result.value;
      questions.push(question);

      const previousId = ids.get(question.id);
      if (previousId) {
        addIssue(
          errors,
          "corpus.id.duplicate",
          `${questionPath}.id`,
          `Question ID duplicates ${previousId}.`,
        );
      } else {
        ids.set(question.id, questionPath);
      }

      const promptKey = normalizedIdentity(question.prompt);
      const previousPrompt = prompts.get(promptKey);
      if (previousPrompt) {
        addIssue(
          errors,
          "corpus.prompt.duplicate",
          `${questionPath}.prompt`,
          `Normalized prompt duplicates ${previousPrompt}.`,
        );
      } else {
        prompts.set(promptKey, questionPath);
      }

      if (question.clip) {
        const previousClip = clipIds.get(question.clip.id);
        if (previousClip) {
          addIssue(
            errors,
            "corpus.clip_id.duplicate",
            `${questionPath}.clip.id`,
            `Clip ID duplicates ${previousClip}.`,
          );
        } else {
          clipIds.set(question.clip.id, questionPath);
        }
      }
    });
  }

  if (options.minimumQuestions !== undefined && questions.length < options.minimumQuestions) {
    addIssue(
      errors,
      "corpus.count.minimum",
      "corpus",
      `Found ${questions.length} valid questions; at least ${options.minimumQuestions} are required.`,
    );
  }
  if (options.requireAllFormats) {
    const present = new Set(questions.map((question) => question.format));
    for (const format of QUESTION_FORMATS) {
      if (!present.has(format)) {
        addIssue(
          errors,
          "corpus.format.missing",
          "corpus",
          `No active question uses the ${format} format.`,
        );
      }
    }
  }

  const stats = emptyStats();
  stats.total = questions.length;
  for (const question of questions) {
    increment(stats.categories, question.category);
    increment(stats.formats, question.format);
    increment(stats.difficulties, String(question.difficulty));
    increment(stats.publishers, question.source.publisher);
    increment(stats.sourceUrls, question.source.url);
  }

  if (questions.length >= 10) {
    for (const [publisher, count] of Object.entries(stats.publishers)) {
      if (count / questions.length > 0.5) {
        addIssue(
          warnings,
          "corpus.source.concentration",
          "corpus",
          `${publisher} supplies ${count} of ${questions.length} questions; editorial diversity review is required.`,
        );
      }
    }
  }

  return { questions, errors, warnings, stats };
}

export function sanitizePrivateQuestion(question: PrivateQuestion): PublicQuestion {
  return {
    key: question.id,
    category: question.category,
    difficulty: question.difficulty,
    format: question.format,
    prompt: question.prompt,
    choices: [...question.choices] as QuestionChoices,
    clip: question.clip
      ? {
          id: question.clip.id,
          textClue: question.clip.textClue,
        }
      : null,
  };
}

export function createAnswerDisclosure(question: PrivateQuestion): AnswerDisclosure {
  return {
    source: {
      publisher: question.source.publisher,
      title: question.source.title,
      url: question.source.url,
    },
    clipAttribution: question.clip
      ? {
          creator: question.clip.attribution.creator,
          copyrightNotice: question.clip.attribution.copyrightNotice,
          licenseTitle: question.clip.attribution.licenseTitle,
          licenseUrl: question.clip.attribution.licenseUrl,
          sourceTitle: question.clip.attribution.sourceTitle,
          sourceUrl: question.clip.attribution.sourceUrl,
        }
      : null,
  };
}
