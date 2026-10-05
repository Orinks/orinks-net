import type { NextConfig } from "next";

// The game's presence heartbeat is the site's most frequent request, and all
// it does is call one Convex mutation. Sent straight to the Convex HTTP router
// (convex/http.ts) it runs no Vercel function at all. Only the game's
// authenticated calls go: the public board GET carries no Authorization header
// and stays on the cached snapshot served here. Without a Convex cloud URL at
// build time there is nothing to point at, and the Next route answers instead.
export function presenceRewrites(convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL) {
  const origin = convexUrl && /^(https:\/\/[^/]+)\.convex\.cloud\/?$/.exec(convexUrl)?.[1];

  if (!origin) {
    return [];
  }

  return [
    {
      source: "/api/freight-fate/presence",
      has: [{ type: "header" as const, key: "authorization" }],
      destination: `${origin}.convex.site/freight-fate/presence`,
    },
  ];
}

const nextConfig: NextConfig = {
  // beforeFiles, because an ordinary rewrite never shadows a route that exists.
  async rewrites() {
    return { beforeFiles: presenceRewrites(), afterFiles: [], fallback: [] };
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "github.com",
      },
    ],
  },
  // Generated clip filenames are a hash of voice + model + settings + text, so
  // a given URL's bytes can never change — regenerating audio writes a new name
  // and a new manifest. That makes them safe to pin forever, which matters:
  // without this they default to must-revalidate, so every replay of every line
  // is a fresh conditional request. manifest.json is deliberately left out — it
  // is the mutable pointer that has to be re-read to discover the new hashes.
  async headers() {
    return [
      {
        source: "/audio/trivia/:kind(barks|questions|story|music|stings)/:file*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/grimatonics",
        destination: "/channel-3000/grimatonics",
        permanent: true,
      },
      {
        source: "/projects/accessiweather",
        destination: "/accessiweather",
        permanent: true,
      },
      {
        source: "/projects/portkeydrop",
        destination: "/portkeydrop",
        permanent: true,
      },
      {
        source: "/projects/station-scout",
        destination: "/station-scout",
        permanent: true,
      },
      {
        source: "/projects/accessisky",
        destination: "/accessisky",
        permanent: true,
      },
      {
        source: "/projects/accessiclock",
        destination: "/accessiclock",
        permanent: true,
      },
      {
        source: "/projects/spectra",
        destination: "/spectra",
        permanent: true,
      },
      {
        source: "/audio-games",
        destination: "/games",
        permanent: true,
      },
      {
        source: "/audio-games/downloads",
        destination: "/games",
        permanent: true,
      },
      {
        source: "/game-mods/eurofly-enhanced-mod",
        destination: "/eurofly-enhanced-mod",
        permanent: true,
      },
      {
        source: "/wp-content/uploads/2021/10/Eurofly-Enhanced-1.4.zip",
        destination: "/downloads/Eurofly-Enhanced-1.4.zip",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
