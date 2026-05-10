import { ProjectLanding } from "@/components/ProjectLanding";
import { getProject } from "@/lib/site";

export const metadata = {
  title: "AccessiClock",
};

export default function AccessiClockPage() {
  return <ProjectLanding project={getProject("/accessiclock")!} />;
}
