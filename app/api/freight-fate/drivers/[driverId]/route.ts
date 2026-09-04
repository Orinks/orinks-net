import { NextResponse } from "next/server";
import { getFreightFateDriverProfileSummary, normalizeFreightFateDriverId } from "@/lib/freight-fate-online";

export const runtime = "nodejs";

// The in-game driver profile: what the game reads when a player opens a
// driver from the drivers list, or their own profile from the Online menu.
// Public and unauthenticated, exactly like the profile page it mirrors and
// the presence GET beside it, so it reads from the same kind of cached
// summary rather than the backend. `no-store` keeps clients from holding a
// profile past that minute; the cache is what keeps the backend cost flat.
export async function GET(
  _request: Request,
  context: { params: Promise<{ driverId: string }> },
) {
  let driverId: string;
  try {
    driverId = normalizeFreightFateDriverId((await context.params).driverId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid driver ID.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const result = await getFreightFateDriverProfileSummary(driverId);

  if (!result.configured) {
    return NextResponse.json({ error: "Freight Fate online profiles are not configured." }, { status: 503 });
  }

  // Unknown, private, or held for moderation all answer the same way, on
  // purpose: the page does not tell those apart either.
  if (!result.profile) {
    return NextResponse.json({ error: "profile_not_public" }, { status: 404, headers: { "cache-control": "no-store" } });
  }

  return NextResponse.json(result.profile, {
    headers: { "cache-control": "no-store" },
  });
}
