import { NextResponse } from "next/server";
import { getFreightFateDriverProfile, normalizeFreightFateDriverId } from "@/lib/freight-fate-online";

export const runtime = "nodejs";

type DriverRouteProps = {
  params: Promise<{ driverId: string }>;
};

export async function GET(_request: Request, { params }: DriverRouteProps) {
  try {
    const { driverId: rawDriverId } = await params;
    const driverId = normalizeFreightFateDriverId(rawDriverId);
    const profile = await getFreightFateDriverProfile(driverId);

    if (!profile) {
      return NextResponse.json({ error: "Driver profile was not found." }, { status: 404 });
    }

    if (profile.driver.visibility === "private") {
      return NextResponse.json({
        driver: profile.driver,
        events: [],
        private: true,
      });
    }

    return NextResponse.json({ ...profile, private: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid driver profile request.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
