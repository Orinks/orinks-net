import { NextResponse } from "next/server";
import { getVisitCount, incrementVisitCount } from "@/lib/convex";

export async function GET() {
  try {
    const counts = await getVisitCount();

    if (counts == null) {
      return NextResponse.json({ error: "Convex is not configured.", durable: false }, { status: 503 });
    }

    // Read side only: a short CDN cache is enough for a visitor counter. The POST
    // below is never cached and always returns fresh counts.
    return NextResponse.json(
      { ...counts, durable: true },
      {
        headers: {
          "cache-control": "public, max-age=0, must-revalidate",
          "vercel-cdn-cache-control": "max-age=60, stale-while-revalidate=60",
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Convex error";

    return NextResponse.json({ error: message, durable: false }, { status: 503 });
  }
}

export async function POST() {
  try {
    const counts = await incrementVisitCount();

    if (counts == null) {
      return NextResponse.json({ error: "Convex is not configured.", durable: false }, { status: 503 });
    }

    return NextResponse.json({ ...counts, durable: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Convex error";

    return NextResponse.json({ error: message, durable: false }, { status: 503 });
  }
}
