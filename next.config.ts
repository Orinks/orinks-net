import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
