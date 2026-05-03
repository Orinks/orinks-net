import { NextResponse } from "next/server";
import { getVisitCount } from "@/lib/convex";

export async function GET() {
  try {
    const visitCount = await getVisitCount();

    if (visitCount == null) {
      return NextResponse.json({
        ok: true,
        database: "convex not configured",
        stack: ["Next.js", "React", "Tailwind CSS", "Vercel"],
      });
    }

    return NextResponse.json({
      ok: true,
      database: "convex connected",
      stack: ["Next.js", "React", "Tailwind CSS", "Vercel", "Convex"],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Convex error";

    return NextResponse.json(
      {
        ok: false,
        database: "convex connection failed",
        error: message,
      },
      { status: 503 },
    );
  }
}
