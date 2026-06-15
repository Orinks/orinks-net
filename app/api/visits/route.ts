import { NextResponse } from "next/server";
import { getVisitCount, incrementVisitCount } from "@/lib/convex";

export async function GET() {
  try {
    const counts = await getVisitCount();

    if (counts == null) {
      return NextResponse.json({ error: "Convex is not configured.", durable: false }, { status: 503 });
    }

    return NextResponse.json({ ...counts, durable: true });
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
