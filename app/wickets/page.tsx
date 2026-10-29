import { ProjectLanding } from "@/components/ProjectLanding";
import { getGame } from "@/lib/site";

export const metadata = {
  title: "Wicket's",
};

export default function WicketsPage() {
  return <ProjectLanding project={getGame("/wickets")!} />;
}
