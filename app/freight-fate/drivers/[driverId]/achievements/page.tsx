import type { Metadata } from "next";
import { DriverProfileView, parseAchievementCursor, safeProfile } from "../profile-view";

type Props = {
  params: Promise<{ driverId: string }>;
  searchParams: Promise<{ before?: string }>;
};

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const profile = await safeProfile((await params).driverId);
  return profile ? { title: `Account-wide achievements for ${profile.driver.displayName}` } : { title: "Freight Fate Profile Unavailable" };
}

export default async function Page({ params, searchParams }: Props) {
  const achievementCursor = parseAchievementCursor((await searchParams).before);
  return <DriverProfileView
    achievementCursor={achievementCursor}
    driverId={(await params).driverId}
    section="achievements"
  />;
}
