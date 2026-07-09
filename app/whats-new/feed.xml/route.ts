import { site } from "@/lib/site";
import { whatsNewFeedXml } from "@/lib/whats-new";

// Built statically at deploy time, so a malformed announcement fails the
// build here too — the feed sits inside the same gate as the page.
export const dynamic = "force-static";

export function GET() {
  return new Response(whatsNewFeedXml(site.name, site.url), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
