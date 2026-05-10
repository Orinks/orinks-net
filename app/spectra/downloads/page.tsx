import { UnavailableDownloads } from "@/components/UnavailableDownloads";
import { getProject } from "@/lib/site";

export const metadata = {
  title: "Spectra Downloads",
};

export default function SpectraDownloadsPage() {
  return <UnavailableDownloads project={getProject("/spectra")!} />;
}
