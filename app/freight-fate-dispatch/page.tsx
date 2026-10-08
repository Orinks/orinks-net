import { ProjectLanding } from "@/components/ProjectLanding";
import { getGame } from "@/lib/site";

export const metadata = {
  title: "Freight Fate: Dispatch",
};

export default function FreightFateDispatchPage() {
  return <ProjectLanding project={getGame("/freight-fate-dispatch")!} />;
}
