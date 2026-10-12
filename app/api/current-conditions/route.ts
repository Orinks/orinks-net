import { NextResponse } from "next/server";
import { getCurrentConditions } from "@/lib/weather";

export async function GET() {
  try {
    return NextResponse.json(await getCurrentConditions(), {
      headers: {
        "cache-control": "public, max-age=0, must-revalidate",
        "vercel-cdn-cache-control": "max-age=300, stale-while-revalidate=300",
      },
    });
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
