import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { audioPath, segments } from "./after-hours";
import { transcripts } from "./after-hours-transcripts";

describe("after hours segments", () => {
  test("every segment has its MP3 in public/, its size as stored, and a unique slug", () => {
    expect(new Set(segments.map((s) => s.slug)).size).toBe(segments.length);
    for (const segment of segments) {
      const file = join(process.cwd(), "public", audioPath(segment.slug));
      expect(existsSync(file), segment.slug).toBe(true);
      expect(segment.megabytes, segment.slug).toBe((statSync(file).size / 1e6).toFixed(1));
    }
  });

  test("every segment has its transcript, and there is no transcript without a segment", () => {
    expect(Object.keys(transcripts).sort()).toEqual(segments.map((s) => s.slug).sort());
    for (const lines of Object.values(transcripts)) expect(lines.length).toBeGreaterThan(0);
  });
});
