import { ProjectLanding } from "@/components/ProjectLanding";
import { getProject } from "@/lib/site";

export const metadata = {
  title: "PortkeyDrop",
};

export default function PortkeyDropPage() {
  return <ProjectLanding project={getProject("/portkeydrop")!} />;
}
