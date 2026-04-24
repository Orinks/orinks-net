import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/neon";

export async function GET() {
  const sql = getDatabase();

  if (!sql) {
    return NextResponse.json({
      ok: true,
      database: "not configured",
      stack: ["Next.js", "React", "Tailwind CSS", "Neon", "DigitalOcean App Platform"],
    });
  }

  try {
    await sql`select 1`;

    return NextResponse.json({
      ok: true,
      database: "connected",
      stack: ["Next.js", "React", "Tailwind CSS", "Neon", "DigitalOcean App Platform"],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error";

    return NextResponse.json(
      {
        ok: false,
        database: "connection failed",
        error: message,
      },
      { status: 503 },
    );
  }
}
