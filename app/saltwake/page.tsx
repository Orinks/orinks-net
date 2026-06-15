import { ProjectLanding } from "@/components/ProjectLanding";
import { getGame } from "@/lib/site";

export const metadata = {
  title: "Saltwake",
};

export default function SaltwakePage() {
  return <ProjectLanding project={getGame("/saltwake")!} />;
}
