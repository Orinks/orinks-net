import { describe, expect, test } from "vitest";
import clipsCatalog from "../data/trivia/clips.json";
import officialSources from "../data/trivia/official-sources.json";
import needleDropBank from "../data/trivia/questions/official-audius-needle-drops.json";
import expandedBank from "../data/trivia/questions/official-audius-expanded.json";
import {
  validateQuestionCorpus,
  type OfficialSourcePolicy,
  type PrivateQuestion,
} from "./questionTypes";

describe("official Audius needle-drop questions", () => {
  test("validates six private questions across both licensed media formats", () => {
    const result = validateQuestionCorpus(
      [{ file: "official-audius-needle-drops.json", data: needleDropBank }],
      officialSources as OfficialSourcePolicy,
      { minimumQuestions: 6 },
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.questions).toHaveLength(6);
    expect(result.questions.map((question) => question.answer)).toEqual([0, 1, 2, 3, 0, 1]);
    expect(result.stats.formats).toMatchObject({ "needle-drop": 5, "sound-lab": 1 });
    expect(result.questions.every((question) => question.source.publisher === "Audius")).toBe(true);
  });

  test("uses every licensed clip once and exactly matches the private clip ledger", () => {
    const ledger = new Map(clipsCatalog.clips.map((clip) => [clip.id, clip]));
    const questions = [
      ...needleDropBank.questions,
      ...expandedBank.questions,
    ] as PrivateQuestion[];
    const used = new Set<string>();

    for (const question of questions) {
      const clip = question.clip!;
      const record = ledger.get(clip.id)!;
      expect(record).toBeDefined();
      expect(used.has(clip.id)).toBe(false);
      used.add(clip.id);
      expect(clip).toEqual({
        id: record.id,
        provider: record.provider,
        providerAssetId: record.providerAssetId,
        startSeconds: record.startSeconds,
        durationSeconds: record.durationSeconds,
        textClue: record.textClue,
        attribution: record.attribution,
      });
      expect(question.source.url).toBe(record.artistPublished.permalink);
      expect(question.source.title).toBe(record.artistPublished.title);
    }

    expect(used.size).toBe(22);
    expect(used).toEqual(new Set(ledger.keys()));
  });
});
