import { ProjectLanding } from "@/components/ProjectLanding";
import { getProject } from "@/lib/site";

export const metadata = {
  title: "Spectra",
};

export default function SpectraPage() {
  return <ProjectLanding project={getProject("/spectra")!} />;
}
