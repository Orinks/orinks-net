import { ClipStreamError } from "./types";

const SINGLE_RANGE = /^bytes=(?:\d+-\d*|-\d+)$/;
const FORWARDED_HEADERS = [
  "accept-ranges",
  "content-length",
  "content-range",
  "content-type",
] as const;

export function normalizeRangeHeader(value: string | null | undefined) {
  if (value == null || value === "") return undefined;
  if (!SINGLE_RANGE.test(value)) {
    throw new ClipStreamError("range.invalid", "Only one valid byte range is supported.", 416);
  }
  return value;
}

export function clientStreamResponse(upstream: Response) {
  if (upstream.status !== 200 && upstream.status !== 206) {
    throw new ClipStreamError("stream.status", "Upstream stream returned an unexpected status.");
  }
  const contentType = upstream.headers.get("content-type")?.toLocaleLowerCase("en-US") ?? "";
  if (!contentType.startsWith("audio/")) {
    throw new ClipStreamError("stream.content_type", "Upstream stream was not audio.");
  }

  const headers = new Headers({
    "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of FORWARDED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, {
    headers,
    status: upstream.status,
    statusText: upstream.statusText,
  });
}

export function providerUnavailableResponse() {
  return Response.json(
    { error: "Mystery clip is temporarily unavailable." },
    {
      status: 503,
      headers: {
        "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
        Pragma: "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
