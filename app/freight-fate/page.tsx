import { ProjectLanding } from "@/components/ProjectLanding";
import { getProject } from "@/lib/site";

export const metadata = {
  title: "Freight Fate",
};

export default function FreightFatePage() {
  return <ProjectLanding project={getProject("/freight-fate")!} />;
}
