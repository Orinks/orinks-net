import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/neon";

export async function GET() {
  const sql = getDatabase();

  if (!sql) {
    return NextResponse.json({
      ok: true,
      database: "not configured",
      stack: ["Next.js", "React", "Tailwind CSS", "Neon", "Contabo VPS"],
    });
  }

  try {
    await sql`select 1`;

    return NextResponse.json({
      ok: true,
      database: "connected",
      stack: ["Next.js", "React", "Tailwind CSS", "Neon", "Contabo VPS"],
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
