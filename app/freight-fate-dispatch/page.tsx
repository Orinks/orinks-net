import { ProjectLanding } from "@/components/ProjectLanding";
import { getGame } from "@/lib/site";

const project = getGame("/freight-fate-dispatch")!;

export const metadata = {
  title: project.title,
  description: project.summary,
};

export default function FreightFateDispatchPage() {
  return <ProjectLanding project={project} />;
}
