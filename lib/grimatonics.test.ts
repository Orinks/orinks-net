import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { audioPath, songs } from "./grimatonics";
import { lyrics } from "./grimatonics-lyrics";

describe("grimatonics songs", () => {
  test("every song has its MP3 in public/ and a unique slug", () => {
    expect(new Set(songs.map((s) => s.slug)).size).toBe(songs.length);
    for (const song of songs) {
      expect(existsSync(join(process.cwd(), "public", audioPath(song.slug))), song.slug).toBe(true);
    }
  });

  test("every song has its words, and there are no words without a song", () => {
    expect(Object.keys(lyrics).sort()).toEqual(songs.map((s) => s.slug).sort());
    for (const verses of Object.values(lyrics)) expect(verses.length).toBeGreaterThan(0);
  });
});
