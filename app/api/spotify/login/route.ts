import { NextResponse, type NextRequest } from "next/server";

import { getSpotifyLoginKey, getSpotifyRedirectUri, SPOTIFY_AUTH_SCOPES } from "@/lib/spotify";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const loginKey = getSpotifyLoginKey();
  const suppliedKey = request.nextUrl.searchParams.get("key");

  if (!loginKey || suppliedKey !== loginKey) {
    return new NextResponse("Not found", { status: 404 });
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "SPOTIFY_CLIENT_ID is not configured." }, { status: 500 });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getSpotifyRedirectUri(),
    response_type: "code",
    scope: SPOTIFY_AUTH_SCOPES.join(" "),
    state: loginKey,
  });

  return NextResponse.redirect(`https://accounts.spotify.com/authorize?${params}`);
}
