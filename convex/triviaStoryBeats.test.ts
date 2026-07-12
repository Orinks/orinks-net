import { describe, expect, test } from "vitest";
import { storyBeatForRound, storyBeatInventory } from "./triviaStoryBeats";

describe("broadcast story beats", () => {
  test("has a restrained, varied inventory with transcripts", () => {
    const beats = storyBeatInventory();
    expect(beats).toHaveLength(36);
    expect(
      new Set(beats.map((beat) => beat.family)).size,
    ).toBeGreaterThanOrEqual(9);
    expect(beats.every((beat) => beat.title && beat.speaker && beat.text)).toBe(
      true,
    );
  });

  test("daily chapters are deterministic and identical for every player", () => {
    const first = storyBeatForRound({
      seed: "daily:2026-07-10",
      round: 3,
      isDaily: true,
    });
    const second = storyBeatForRound({
      seed: "daily:2026-07-10",
      round: 3,
      isDaily: true,
    });
    expect(second).toEqual(first);
  });

  test("does not repeat beats within a regular or daily run", () => {
    for (const isDaily of [false, true]) {
      const count = isDaily ? 16 : 24;
      const ids = Array.from(
        { length: count },
        (_, index) =>
          storyBeatForRound({ seed: "same-run", round: index + 1, isDaily })
            ?.id,
      ).filter(Boolean);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("prefers a compatible legacy archive beat without excluding official formats", () => {
    expect(
      storyBeatForRound({
        seed: "legacy",
        round: 1,
        isDaily: false,
        format: "legacy-trivia",
      })?.formats,
    ).toContain("legacy-trivia");
    expect(
      storyBeatForRound({
        seed: "audius",
        round: 1,
        isDaily: false,
        format: "needle-drop",
      })?.formats,
    ).toContain("needle-drop");
  });

  test("story ends quietly rather than repeating or gating play", () => {
    expect(
      storyBeatForRound({ seed: "long", round: 99, isDaily: false }),
    ).toBeNull();
  });
});
