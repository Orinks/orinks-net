import { site } from "@/lib/site";
import { getWhatsNewEntries, mergeWhatsNewEntries, whatsNewFeedXml } from "@/lib/whats-new";
import { getStationNewsEntries } from "@/lib/whats-new-stations";

// Built at deploy time, so a malformed announcement fails the build here too:
// the feed sits inside the same gate as the page. It is rebuilt every ten
// minutes after that so accepted radio stations reach feed readers.
export const revalidate = 600;

export async function GET() {
  const entries = mergeWhatsNewEntries(getWhatsNewEntries(), await getStationNewsEntries());
  return new Response(whatsNewFeedXml(site.name, site.url, entries), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
