// The paper as the game reads it aloud: GET /api/freight-fate/news. One
// edition turned into sections of plain spoken lines, so the game needs no
// phrases file, catalog or table layout of its own. Built from the same view
// the page draws (lib/freight-fate-paper-view.ts), so the two never disagree
// about what an issue holds.
//
// Version 1. The game refuses any other version, any line over
// PAPER_SPEECH_MAX_LINE characters and any issue over PAPER_SPEECH_MAX_LINES
// lines, so the limits here match the game's.
import { formatPaperNumber, type PaperTextSegment } from "./freight-fate-paper-text";
import {
  buildPaperView,
  paperPeriodText,
  paperRecordResult,
  type PaperChrome,
  type PaperEditionData,
  type PaperViewSection,
  type PaperViewStory,
} from "./freight-fate-paper-view";

export const PAPER_SPEECH_VERSION = 1;
export const PAPER_SPEECH_MAX_LINE = 600;
export const PAPER_SPEECH_MAX_LINES = 400;

export type PaperSpeechSection = { heading: string; lines: string[] };

export type PaperSpeech = {
  version: typeof PAPER_SPEECH_VERSION;
  issue: number;
  masthead: string;
  /** The header's date text: "November 16 to 22, 2026". */
  dates: string;
  /** Present only when the page would show it. */
  sinceMonday?: { heading: string; sentence: string };
  sections: PaperSpeechSection[];
};

/**
 * Plain text a screen reader reads cleanly: no markup, no links, no percent
 * sign, no control characters, one space between words.
 */
export function paperSpeechText(text: string) {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[<>]/g, "")
    .replace(/(\d)\s*%/g, "$1 percent")
    .replace(/%/g, " percent")
    // Control characters (including tabs and line breaks) become spaces.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function plain(segments: PaperTextSegment[]) {
  return segments.map((segment) => ("text" in segment ? segment.text : segment.displayName)).join("");
}

/** A headline and its body as one spoken run: "Headline. Body." */
function storyLine(headline: string, body: string) {
  const head = paperSpeechText(headline);
  const rest = paperSpeechText(body);
  const ended = /[.!?]$/.test(head) ? head : `${head}.`;
  return rest ? `${ended} ${rest}` : ended;
}

function storyLines(sectionKey: string, story: PaperViewStory): string[] {
  const headline = plain(story.headline);
  if (story.list) {
    return [storyLine(headline, ""), ...story.list.map((driver) => storyLine(driver.displayName, ""))];
  }
  // Game news is the headline; its release notes are a web link.
  if (sectionKey === "game_news") return [storyLine(headline, "")];
  return [storyLine(headline, plain(story.body))];
}

function counted(value: number, one: string, other: string) {
  return `${formatPaperNumber(value)} ${value === 1 ? one : other}`;
}

/** "Most miles: Dana Rig, 4,210 miles." */
export function recordLine(row: PaperEditionData["records"][number]) {
  return `${paperSpeechText(row.label)}: ${paperSpeechText(row.displayName)}, ${paperRecordResult(row.record, row.value)}.`;
}

/** "Northstar Freight Lines: 26,400 miles, 58 loads, 12 drivers on the road, 96.5 percent on time." */
export function standingLine(row: PaperEditionData["standings"][number]) {
  const parts = [
    counted(row.miles, "mile", "miles"),
    counted(row.loads, "load", "loads"),
    `${counted(row.drivers, "driver", "drivers")} on the road`,
  ];
  if (row.onTimeRate !== undefined) parts.push(`${formatPaperNumber(row.onTimeRate)} percent on time`);
  return `${paperSpeechText(row.carrier)}: ${parts.join(", ")}.`;
}

function sectionLines(section: PaperViewSection, edition: PaperEditionData): string[] {
  if (section.key === "records") return edition.records.map(recordLine);
  if (section.key === "carrier_standings") return edition.standings.map(standingLine);
  return section.stories.flatMap((story) => storyLines(section.key, story));
}

/** One edition as the game's spoken body. `latest` as for the page: only the latest carries Since Monday. */
export function paperSpeech(edition: PaperEditionData, chrome: PaperChrome, options: { latest: boolean }): PaperSpeech {
  const view = buildPaperView(edition, chrome, options);
  const speech: PaperSpeech = {
    version: PAPER_SPEECH_VERSION,
    issue: edition.issue,
    masthead: paperSpeechText(chrome.masthead),
    dates: paperPeriodText(edition.periodStart, edition.periodEnd),
    sections: [],
  };
  for (const section of view.sections) {
    if (section.key === "since_monday") {
      const sentence = plain(section.paragraphs?.[0] ?? []);
      if (!sentence) continue;
      speech.sinceMonday = {
        heading: paperSpeechText(`${section.heading}${section.headingDay ? `, ${section.headingDay.label}` : ""}`),
        sentence: paperSpeechText(section.asOf ? `As of ${section.asOf.label}: ${sentence}` : sentence),
      };
      continue;
    }
    const lines = sectionLines(section, edition).filter((line) => line !== "" && line !== ".");
    if (lines.length > 0) speech.sections.push({ heading: paperSpeechText(section.heading), lines });
  }
  if (view.backPage) {
    const lines = view.backPage.pieces.flatMap((piece) => [
      storyLine(piece.title, ""),
      ...piece.body.map((paragraph) => paperSpeechText(paragraph)).filter(Boolean),
    ]);
    if (lines.length > 0) speech.sections.push({ heading: paperSpeechText(view.backPage.heading), lines });
  }
  return fitPaperSpeech(speech);
}

/**
 * Keep the body inside the game's limits rather than have the game refuse
 * the whole issue: a line too long is cut at the last word boundary that
 * fits, and lines past the issue's limit are dropped from the end, so the
 * back page goes before the front page.
 */
function fitPaperSpeech(speech: PaperSpeech): PaperSpeech {
  const fit = (line: string) => {
    if (line.length <= PAPER_SPEECH_MAX_LINE) return line;
    const cut = line.slice(0, PAPER_SPEECH_MAX_LINE - 1);
    const space = cut.lastIndexOf(" ");
    return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[,;:]$/, "")}.`;
  };
  let budget = PAPER_SPEECH_MAX_LINES - (speech.sinceMonday ? 1 : 0);
  const sections: PaperSpeechSection[] = [];
  for (const section of speech.sections) {
    if (budget <= 0) break;
    const lines = section.lines.slice(0, budget).map(fit);
    budget -= lines.length;
    sections.push({ heading: fit(section.heading), lines });
  }
  return {
    ...speech,
    ...(speech.sinceMonday
      ? { sinceMonday: { heading: fit(speech.sinceMonday.heading), sentence: fit(speech.sinceMonday.sentence) } }
      : {}),
    sections,
  };
}
