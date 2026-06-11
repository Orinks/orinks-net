import { ProjectLanding } from "@/components/ProjectLanding";
import { getGame } from "@/lib/site";

export const metadata = {
  title: "Freight Fate",
};

export default function FreightFatePage() {
  return <ProjectLanding project={getGame("/freight-fate")!} />;
}
