import type { Metadata } from "next";
import { DriverProfileView, safeProfile } from "./profile-view";

type DriverPageProps = {
  params: Promise<{ driverId: string }>;
  searchParams: Promise<{ setup?: string }>;
};

export async function generateMetadata({ params }: Pick<DriverPageProps, "params">): Promise<Metadata> {
  const profile = await safeProfile((await params).driverId);
  return profile
    ? { title: `${profile.driver.displayName} - Freight Fate Driver` }
    : { title: "Freight Fate Profile Unavailable" };
}

export default async function FreightFateDriverPage({ params, searchParams }: DriverPageProps) {
  const { driverId } = await params;
  const query = await searchParams;
  return <DriverProfileView confirmed={query.setup === "confirmed"} driverId={driverId} section="overview" />;
}
