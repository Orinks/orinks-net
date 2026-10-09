import { describe, expect, test } from "vitest";
import {
  callSignBase,
  isPublicAddress,
  judgeProbe,
  normalizeCallSign,
  normalizeFrequency,
  normalizeState,
  normalizeStreamUrl,
  validateSuggestion,
} from "./freightFateStationRules";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

describe("normalizeStreamUrl", () => {
  // The same cases the game's normalize_stream_url pins, so both sides agree
  // on what "the same stream" means.
  test("drops the scheme, a trailing slash or semicolon, and folds the host", () => {
    expect(normalizeStreamUrl("https://Stream.Example.com/live/")).toBe("stream.example.com/live");
    expect(normalizeStreamUrl("http://stream.example.com/live")).toBe("stream.example.com/live");
    expect(normalizeStreamUrl("http://198.37.123.243:8242/;")).toBe("198.37.123.243:8242");
  });

  test("keeps a case-sensitive path as it is", () => {
    expect(normalizeStreamUrl("https://host.example/Live")).not.toBe(normalizeStreamUrl("https://host.example/live"));
  });

  test("folds Live365 edges and bitrates onto the station id", () => {
    expect(normalizeStreamUrl("https://ais-sa5.cdnstream1.com/b09584_128mp3?x=1")).toBe(
      "streaming.live365.com/b09584",
    );
    expect(normalizeStreamUrl("https://streaming.live365.com/b09584_64aac")).toBe("streaming.live365.com/b09584");
  });
});

describe("the form", () => {
  test("a web radio station needs a name and a stream address", () => {
    const result = validateSuggestion({ kind: "web", name: "  Night  Owl Radio ", streamUrl: "https://s.example/live#x" });
    expect(result).toEqual({
      ok: true,
      value: { kind: "web", name: "Night Owl Radio", streamUrl: "https://s.example/live", streamKey: "s.example/live" },
    });
    expect(validateSuggestion({ kind: "web", name: "X", streamUrl: "https://s.example" })).toMatchObject({
      reason: "invalid_name",
    });
    expect(validateSuggestion({ kind: "web", name: "Night Owl", streamUrl: "ftp://s.example" })).toMatchObject({
      reason: "invalid_stream_url",
    });
    expect(validateSuggestion({ kind: "web", name: "Night Owl", streamUrl: "https://me:pw@s.example" })).toMatchObject({
      reason: "invalid_stream_url",
    });
  });

  test("a terrestrial station also needs its call sign and state", () => {
    const form = { kind: "terrestrial", name: "The Cat", streamUrl: "https://s.example/cat" };
    expect(validateSuggestion(form)).toMatchObject({ reason: "invalid_call_sign" });
    expect(validateSuggestion({ ...form, callSign: "kwsc" })).toMatchObject({ reason: "invalid_state" });
    const result = validateSuggestion({
      ...form,
      callSign: "kwsc fm",
      state: "nebraska",
      city: "Wayne",
      frequency: "91.9",
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        callSign: "KWSC-FM",
        callSignBase: "KWSC",
        state: "NE",
        city: "Wayne",
        frequency: "91.9 FM",
        frequencyMhz: 91.9,
      },
    });
    expect(validateSuggestion({ ...form, callSign: "KWSC", state: "NE", frequency: "205" })).toMatchObject({
      reason: "invalid_frequency",
    });
  });

  test("over-long text is refused, never cut short", () => {
    const form = { kind: "web", name: "Night Owl", streamUrl: "https://s.example" };
    expect(validateSuggestion({ ...form, note: "x".repeat(281) })).toMatchObject({ reason: "note_too_long" });
    expect(validateSuggestion({ ...form, name: "x".repeat(61) })).toMatchObject({ reason: "name_too_long" });
    expect(validateSuggestion({ ...form, note: "x".repeat(280) })).toMatchObject({ ok: true });
  });

  test("every refusal carries a sentence for the player", () => {
    const result = validateSuggestion({ kind: "satellite" });
    expect(result).toMatchObject({ ok: false, reason: "invalid_kind" });
    expect((result as { message: string }).message).toMatch(/\.$/);
  });

  test("the small parsers", () => {
    expect(normalizeState("OH")).toBe("OH");
    expect(normalizeState(" new york ")).toBe("NY");
    expect(normalizeState("Ontario")).toBeNull();
    expect(normalizeCallSign("W1XYZ")).toBeNull();
    expect(normalizeCallSign("kabc-am")).toBe("KABC-AM");
    expect(callSignBase("WNYC-FM")).toBe("WNYC");
    expect(normalizeFrequency("1090 AM")).toEqual({ text: "1090 AM" });
    expect(normalizeFrequency("1090")).toEqual({ text: "1090 AM" });
    expect(normalizeFrequency("101.5 fm")).toEqual({ text: "101.5 FM", frequencyMhz: 101.5 });
    expect(normalizeFrequency("150")).toBeNull();
  });
});

describe("judgeProbe", () => {
  test("names the audio format from the content type", () => {
    expect(judgeProbe("audio/mpeg", bytes())).toEqual({ verdict: "audio", format: "mp3" });
    expect(judgeProbe("audio/aacp; charset=x", bytes())).toEqual({ verdict: "audio", format: "aac+" });
    expect(judgeProbe("application/ogg", bytes())).toEqual({ verdict: "audio", format: "ogg" });
  });

  test("sniffs untyped audio from its first bytes", () => {
    expect(judgeProbe("", text("OggS...."))).toEqual({ verdict: "audio", format: "ogg" });
    expect(judgeProbe("application/octet-stream", bytes(0, 0xff, 0xfb, 0x90))).toEqual({ verdict: "audio", format: "mp3" });
    expect(judgeProbe("", bytes(0xff, 0xf1, 0x50))).toEqual({ verdict: "audio", format: "aac" });
  });

  test("tells HLS from a plain playlist, and follows a playlist's first entry", () => {
    expect(judgeProbe("application/vnd.apple.mpegurl", text("#EXTM3U\n#EXT-X-VERSION:3\nchunk.ts\n"))).toEqual({
      verdict: "hls",
    });
    expect(judgeProbe("audio/x-scpls", text("[playlist]\nFile1=http://s.example:8000/live\n"))).toEqual({
      verdict: "playlist",
      next: "http://s.example:8000/live",
    });
    expect(judgeProbe("audio/x-mpegurl", text("#EXTM3U\n#EXTINF:-1,Live\nhttps://s.example/a\n"))).toEqual({
      verdict: "playlist",
      next: "https://s.example/a",
    });
  });

  test("calls a web page a web page", () => {
    expect(judgeProbe("text/html; charset=utf-8", text("<!doctype html>"))).toEqual({ verdict: "web_page" });
    expect(judgeProbe("text/plain", text("hello"))).toEqual({ verdict: "not_audio" });
  });
});

describe("isPublicAddress", () => {
  test("refuses the server's own neighbourhood", () => {
    for (const address of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1",
      "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  test("allows the open internet", () => {
    for (const address of ["198.37.123.243", "8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });
});
