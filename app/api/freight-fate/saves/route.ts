import { NextResponse } from "next/server";
import {
  FREIGHT_FATE_MAX_SAVE_BYTES,
  decodeFreightFateSaveContent,
  listFreightFateSaves,
  normalizeFreightFateDriverId,
  normalizeFreightFateSaveName,
  normalizeFreightFateToken,
  postFreightFateSave,
} from "@/lib/freight-fate-online";

export const runtime = "nodejs";

type SaveUploadRequest = {
  driverId?: unknown;
  saveName?: unknown;
  saveVersion?: unknown;
  parentRevision?: unknown;
  contentHash?: unknown;
  content?: unknown;
  summary?: unknown;
};

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);

  return match?.[1];
}

const FAILURE_STATUS: Record<string, number> = {
  driver_not_found: 404,
  unauthorized: 401,
  save_not_found: 404,
  conflict: 409,
  too_large: 413,
  too_many_slots: 409,
  hash_mismatch: 400,
};

export async function POST(request: Request) {
  try {
    const driverToken = normalizeFreightFateToken(bearerToken(request), "Driver token");
    const body = (await request.json()) as SaveUploadRequest;
    const driverId = normalizeFreightFateDriverId(body.driverId);
    const saveName = normalizeFreightFateSaveName(body.saveName);

    if (typeof body.saveVersion !== "number" || !Number.isInteger(body.saveVersion)) {
      return NextResponse.json({ error: "saveVersion must be an integer." }, { status: 400 });
    }

    const parentRevision = body.parentRevision === null ? null : body.parentRevision;
    if (parentRevision !== null && (typeof parentRevision !== "number" || !Number.isInteger(parentRevision))) {
      return NextResponse.json({ error: "parentRevision must be an integer or null." }, { status: 400 });
    }

    if (typeof body.contentHash !== "string" || !/^[0-9a-f]{64}$/.test(body.contentHash)) {
      return NextResponse.json({ error: "contentHash must be a sha256 hex digest." }, { status: 400 });
    }

    const content = decodeFreightFateSaveContent(body.content);
    if (content.byteLength > FREIGHT_FATE_MAX_SAVE_BYTES) {
      return NextResponse.json({ error: "Save content is too large." }, { status: 413 });
    }

    const summary = typeof body.summary === "string" ? body.summary : "";

    const result = await postFreightFateSave({
      driverId,
      driverToken,
      saveName,
      saveVersion: body.saveVersion,
      parentRevision,
      contentHash: body.contentHash,
      content,
      summary,
    });

    if (!result) {
      return NextResponse.json({ error: "Freight Fate cloud saves are not configured." }, { status: 503 });
    }

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.reason,
          latestRevision: result.latestRevision ?? null,
          latestCreatedAt: result.latestCreatedAt ?? null,
          latestSummary: result.latestSummary ?? null,
        },
        { status: FAILURE_STATUS[result.reason] ?? 400 },
      );
    }

    return NextResponse.json({ ok: true, revision: result.revision });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid save upload.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(request: Request) {
  try {
    const driverToken = normalizeFreightFateToken(bearerToken(request), "Driver token");
    const url = new URL(request.url);
    const driverId = normalizeFreightFateDriverId(url.searchParams.get("driverId"));

    const result = await listFreightFateSaves({ driverId, driverToken });

    if (!result) {
      return NextResponse.json({ error: "Freight Fate cloud saves are not configured." }, { status: 503 });
    }

    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: FAILURE_STATUS[result.reason] ?? 400 });
    }

    return NextResponse.json(
      { ok: true, saves: result.saves },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid saves request.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
