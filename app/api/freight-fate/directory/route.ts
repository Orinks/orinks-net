import { NextResponse } from "next/server";
import { getFreightFateDriverDirectorySnapshot } from "@/lib/freight-fate-online";

export const runtime = "nodejs";

// The driver directory as the game reads it: every driver with a public
// profile, on duty or not, and when each was last on duty. Public and
// unauthenticated like the presence GET beside it, and served from the same
// kind of one-minute snapshot for the same reason: a player opening the
// directory costs the backend nothing a browser visiting the page did not
// already pay for. `no-store` keeps clients from holding a copy past that
// minute; the snapshot is what keeps the backend cost flat.
export async function GET() {
  const directory = await getFreightFateDriverDirectorySnapshot();

  if (!directory) {
    return NextResponse.json({ error: "Freight Fate online presence is not configured." }, { status: 503 });
  }

  return NextResponse.json(directory, {
    headers: { "cache-control": "no-store" },
  });
}
