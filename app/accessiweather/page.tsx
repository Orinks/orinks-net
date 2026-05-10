import { ProjectLanding } from "@/components/ProjectLanding";
import { getProject } from "@/lib/site";

export const metadata = {
  title: "AccessiWeather",
};

export default function AccessiWeatherPage() {
  return <ProjectLanding project={getProject("/accessiweather")!} />;
}
