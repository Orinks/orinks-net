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
      { error: "Music download is temporarily unavailable." },
      { status: 503 },
    );
  }
}
