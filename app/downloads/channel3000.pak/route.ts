import { NextResponse } from "next/server";
import { FREIGHT_FATE_CHANNEL_3000_PACK_URL } from "@/lib/freight-fate-downloads";

export async function GET() {
  return NextResponse.redirect(FREIGHT_FATE_CHANNEL_3000_PACK_URL, {
    status: 307,
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
