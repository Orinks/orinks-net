import { NextResponse } from "next/server";
import {
  downloadFreightFateSave,
  normalizeFreightFateDriverId,
  normalizeFreightFateSaveName,
  normalizeFreightFateToken,
} from "@/lib/freight-fate-online";

export const runtime = "nodejs";

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);

  return match?.[1];
}

const FAILURE_STATUS: Record<string, number> = {
  driver_not_found: 404,
  unauthorized: 401,
  save_not_found: 404,
  invalid_schema: 422,
  invalid_name: 422,
  unsupported_version: 422,
  signing_unavailable: 503,
};

export async function GET(request: Request) {
  try {
    const driverToken = normalizeFreightFateToken(bearerToken(request), "Driver token");
    const url = new URL(request.url);
    const driverId = normalizeFreightFateDriverId(url.searchParams.get("driverId"));
    const saveName = normalizeFreightFateSaveName(url.searchParams.get("saveName"));

    const revisionParam = url.searchParams.get("revision");
    let revision: number | undefined;
    if (revisionParam !== null) {
      revision = Number(revisionParam);
      if (!Number.isInteger(revision) || revision < 1) {
        return NextResponse.json({ error: "revision must be a positive integer." }, { status: 400 });
      }
    }

    const result = await downloadFreightFateSave({ driverId, driverToken, saveName, revision });

    if (!result) {
      return NextResponse.json({ error: "Freight Fate cloud saves are not configured." }, { status: 503 });
    }

    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: FAILURE_STATUS[result.reason] ?? 400 });
    }

    return NextResponse.json(
      {
        ok: true,
        saveName: result.saveName,
        revision: result.revision,
        saveVersion: result.saveVersion,
        contentHash: result.contentHash,
        sizeBytes: result.sizeBytes,
        summary: result.summary,
        createdAt: result.createdAt,
        content: Buffer.from(result.content).toString("base64"),
        sig: result.sig,
        keyId: result.keyId,
        signedAt: result.signedAt,
        validatorVersion: result.validatorVersion,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid save download.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
