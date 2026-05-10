import { ProjectLanding } from "@/components/ProjectLanding";
import { getProject } from "@/lib/site";

export const metadata = {
  title: "Station Scout",
};

export default function StationScoutPage() {
  return <ProjectLanding project={getProject("/station-scout")!} />;
}
