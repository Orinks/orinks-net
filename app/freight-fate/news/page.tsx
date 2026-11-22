import { PaperEditionPage, paperMetadata } from "./paper-route";

// The edition and its list come through five-minute caches
// (lib/freight-fate-online.ts), and the page is rebuilt on the same beat.
export const revalidate = 300;

export function generateMetadata() {
  return paperMetadata();
}

export default function FreightFateNewsPage() {
  return <PaperEditionPage />;
}
