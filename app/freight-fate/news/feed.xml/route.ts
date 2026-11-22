import { readPaperFeedItems, paperFeedXml } from "@/lib/freight-fate-paper-page";
import { site } from "@/lib/site";

// Rendered per request; the editions under it come through the paper's caches
// (lib/freight-fate-paper-page.ts), so a feed reader costs few backend reads.
export const dynamic = "force-dynamic";

export async function GET() {
  const items = await readPaperFeedItems();
  if (!items || items.length === 0) return new Response("Not found", { status: 404 });
  return new Response(paperFeedXml(site.url, items), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
