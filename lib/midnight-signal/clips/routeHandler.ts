import type { ClipCatalogRecord } from "./types";
import { ClipStreamError } from "./types";
import {
  clientStreamResponse,
  normalizeRangeHeader,
  providerUnavailableResponse,
} from "./stream";

interface RouteDependencies {
  lookup: (opaqueId: string) => ClipCatalogRecord | undefined;
  openStream: (
    record: ClipCatalogRecord,
    options: { range?: string; signal?: AbortSignal },
  ) => Promise<Response>;
}

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
        Pragma: "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export async function serveMysteryClipRequest(
  request: Request,
  opaqueId: string,
  dependencies: RouteDependencies,
) {
  try {
    const range = normalizeRangeHeader(request.headers.get("range"));
    const record = dependencies.lookup(opaqueId);
    if (!record) return providerUnavailableResponse();
    const upstream = await dependencies.openStream(record, {
      range,
      signal: request.signal,
    });
    return clientStreamResponse(upstream);
  } catch (error) {
    if (error instanceof ClipStreamError && error.status === 416) {
      return jsonError("Requested audio range is not supported.", 416);
    }
    return providerUnavailableResponse();
  }
}
