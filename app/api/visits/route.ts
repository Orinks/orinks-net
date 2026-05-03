import { NextResponse } from "next/server";
import { getVisitCount, incrementVisitCount } from "@/lib/convex";

export async function GET() {
  try {
    const count = await getVisitCount();

    if (count == null) {
      return NextResponse.json({ error: "Convex is not configured.", durable: false }, { status: 503 });
    }

    return NextResponse.json({ count, durable: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Convex error";

    return NextResponse.json({ error: message, durable: false }, { status: 503 });
  }
}

export async function POST() {
  try {
    const count = await incrementVisitCount();

    if (count == null) {
      return NextResponse.json({ error: "Convex is not configured.", durable: false }, { status: 503 });
    }

    return NextResponse.json({ count, durable: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Convex error";

    return NextResponse.json({ error: message, durable: false }, { status: 503 });
  }
}
