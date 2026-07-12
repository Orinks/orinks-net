import type { Metadata } from "next";
import { DriverProfileView, parseJournalCursor, safeProfile } from "../profile-view";

type Props = { params: Promise<{ driverId: string }>; searchParams: Promise<{ before?: string }> };

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const profile = await safeProfile((await params).driverId);
  return profile ? { title: `Road Journal for ${profile.driver.displayName}` } : { title: "Freight Fate Profile Unavailable" };
}

export default async function Page({ params, searchParams }: Props) {
  const { driverId } = await params;
  const cursor = parseJournalCursor((await searchParams).before);
  return <DriverProfileView cursor={cursor} driverId={driverId} section="road-journal" />;
}
