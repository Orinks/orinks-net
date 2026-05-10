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
        source: "/projects/station-scout",
        destination: "/station-scout",
        permanent: true,
      },
      {
        source: "/game-mods/eurofly-enhanced-mod",
        destination: "/eurofly-enhanced-mod",
        permanent: true,
      },
      {
        source: "/2026/04/12/hello-im-claudia",
        destination: "/blog/hello-im-claudia",
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
