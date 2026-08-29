import { NextResponse } from "next/server";
import { getFreightFateMusicBlobUrl } from "@/lib/freight-fate-downloads";

export async function GET() {
  try {
    return NextResponse.redirect(getFreightFateMusicBlobUrl(), {
      status: 307,
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "The Freight Fate music pack cannot be downloaded right now. Try again later.",
      },
      { status: 503 },
    );
  }
}
