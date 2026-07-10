import { describe, expect, test } from "vitest";
import {
  clientStreamResponse,
  normalizeRangeHeader,
  providerUnavailableResponse,
} from "./stream";

describe("normalizeRangeHeader", () => {
  test.each(["bytes=0-1023", "bytes=1024-", "bytes=-2048"])(
    "accepts one ordinary byte range: %s",
    (value) => {
      expect(normalizeRangeHeader(value)).toBe(value);
    },
  );

  test.each(["items=0-1", "bytes=0-1,4-5", "bytes=abc-def", "bytes=-"])(
    "rejects malformed or multipart ranges: %s",
    (value) => {
      expect(() => normalizeRangeHeader(value)).toThrow();
    },
  );
});

describe("clientStreamResponse", () => {
  test("forwards safe audio range metadata with a strict no-store policy", () => {
    const upstream = new Response(new Uint8Array([1, 2, 3]), {
      status: 206,
      headers: {
        "accept-ranges": "bytes",
        "content-length": "3",
        "content-range": "bytes 0-2/1000",
        "content-type": "audio/mpeg",
        etag: "provider-secret-etag",
        location: "https://provider.example/answer-bearing-id",
      },
    });

    const response = clientStreamResponse(upstream);

    expect(response.status).toBe(206);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-range")).toBe("bytes 0-2/1000");
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.has("etag")).toBe(false);
    expect(response.headers.has("location")).toBe(false);
  });

  test("rejects non-audio and unexpected upstream status codes", () => {
    expect(() =>
      clientStreamResponse(
        new Response("not audio", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      ),
    ).toThrow();
    expect(() =>
      clientStreamResponse(
        new Response(null, {
          status: 302,
          headers: { "content-type": "audio/mpeg" },
        }),
      ),
    ).toThrow();
  });
});

describe("providerUnavailableResponse", () => {
  test("does not leak provider details and remains non-cacheable", async () => {
    const response = providerUnavailableResponse();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      error: "Mystery clip is temporarily unavailable.",
    });
  });
});
