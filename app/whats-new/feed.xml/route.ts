import { site } from "@/lib/site";
import { getWhatsNewEntries, mergeWhatsNewEntries, whatsNewFeedXml } from "@/lib/whats-new";
import { getStationNewsEntries } from "@/lib/whats-new-stations";

// Rendered per request, like the page, with the station read cached for ten
// minutes. The curated entries are validated when the module loads, so a
// malformed announcement still fails `next build`.
export const dynamic = "force-dynamic";
const curatedEntries = getWhatsNewEntries();

export async function GET() {
  const entries = mergeWhatsNewEntries(curatedEntries, await getStationNewsEntries());
  return new Response(whatsNewFeedXml(site.name, site.url, entries), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
