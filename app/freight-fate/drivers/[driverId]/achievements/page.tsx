import type { Metadata } from "next";
import { DriverProfileView, safeProfile } from "../profile-view";

type Props = { params: Promise<{ driverId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = await safeProfile((await params).driverId);
  return profile ? { title: `Achievements for ${profile.driver.displayName}` } : { title: "Freight Fate Profile Unavailable" };
}

export default async function Page({ params }: Props) {
  return <DriverProfileView driverId={(await params).driverId} section="achievements" />;
}
