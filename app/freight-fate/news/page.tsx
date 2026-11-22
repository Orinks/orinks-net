import { PaperEditionPage, paperMetadata } from "./paper-route";

// Rendered per request over the paper's five-minute cached reads
// (lib/freight-fate-online.ts). A page cache on top would keep a driver who
// turned sharing off in print for up to twice that.
export const dynamic = "force-dynamic";

export function generateMetadata() {
  return paperMetadata();
}

export default function FreightFateNewsPage() {
  return <PaperEditionPage />;
}
