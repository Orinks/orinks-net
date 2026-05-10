import { UnavailableDownloads } from "@/components/UnavailableDownloads";
import { getProject } from "@/lib/site";

export const metadata = {
  title: "AccessiClock Downloads",
};

export default function AccessiClockDownloadsPage() {
  return <UnavailableDownloads project={getProject("/accessiclock")!} />;
}
