import { NextResponse } from "next/server";
import { getCurrentConditions } from "@/lib/weather";

export async function GET() {
  try {
    return NextResponse.json(await getCurrentConditions());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Weather unavailable.";

    return NextResponse.json(
      {
        error: message,
        lines: [
          "Current conditions for Lumberton, New Jersey: Unavailable",
          "Data from: National Weather Service",
        ],
      },
      { status: 503 },
    );
  }
}
