import { NextResponse, type NextRequest } from "next/server";

import { createSpotifyAuthHeader, getSpotifyLoginKey, getSpotifyRedirectUri } from "@/lib/spotify";

export const dynamic = "force-dynamic";

type SpotifyTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expires_in?: number;
};

function htmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function GET(request: NextRequest) {
  const loginKey = getSpotifyLoginKey();
  const state = request.nextUrl.searchParams.get("state");

  if (!loginKey || state !== loginKey) {
    return new NextResponse("Not found", { status: 404 });
  }

  const error = request.nextUrl.searchParams.get("error");
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  const code = request.nextUrl.searchParams.get("code");
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!code || !clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Spotify code, client ID, or client secret is missing." },
      { status: 400 },
    );
  }

  const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      redirect_uri: getSpotifyRedirectUri(),
    }),
    cache: "no-store",
    headers: {
      Authorization: createSpotifyAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!tokenResponse.ok) {
    const details = await tokenResponse.text();
    return NextResponse.json(
      { error: "Spotify token exchange failed.", details },
      { status: tokenResponse.status },
    );
  }

  const token = (await tokenResponse.json()) as SpotifyTokenResponse;
  if (!token.refresh_token) {
    return NextResponse.json(
      { error: "Spotify did not return a refresh token.", scope: token.scope },
      { status: 502 },
    );
  }

  const escapedRefreshToken = htmlEscape(token.refresh_token);

  return new NextResponse(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Spotify authorized</title>
  </head>
  <body>
    <main>
      <h1>Spotify authorized</h1>
      <p>Add this value to Vercel Production as <code>SPOTIFY_REFRESH_TOKEN</code>, then redeploy.</p>
      <p><label for="refresh-token">Refresh token</label></p>
      <textarea id="refresh-token" rows="8" cols="80" readonly>${escapedRefreshToken}</textarea>
    </main>
  </body>
</html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex",
      },
    },
  );
}
