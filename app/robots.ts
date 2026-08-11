import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

// Everything that is not the production site is closed to crawlers entirely.
// Deployment protection is off, so every preview URL is publicly reachable --
// including dev.orinks.net, which is the 1.9 test environment. A crawler
// walking a preview is spending the same request and backend budget as one
// walking the real site, for pages nobody should be finding in search.
function isProduction() {
  return process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === undefined;
}

export default function robots(): MetadataRoute.Robots {
  if (!isProduction()) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          // Cursor pagination is effectively bottomless: every "older" link is
          // a fresh URL, and each one is a server render plus a backend read.
          // The newest page of each feed stays crawlable, which is the part
          // worth finding in search anyway.
          "/freight-fate/updates?before=",
          "/freight-fate/drivers/*/road-journal?before=",
          // A test fixture, not a page.
          "/freight-fate/e2e-fixture",
        ],
      },
      {
        // Bing and Yandex honour this; Google ignores it and is throttled from
        // Search Console instead. Two seconds still lets a full crawl finish
        // in minutes, it just stops the bursts -- measured 2026-08-11, 242 of
        // 386 feed hits arrived less than two seconds apart.
        userAgent: ["bingbot", "Yandex"],
        allow: "/",
        crawlDelay: 2,
      },
    ],
    host: site.url,
  };
}
