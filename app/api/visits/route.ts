import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/neon";

let fallbackVisits = 0;

export async function GET() {
  const db = getDatabase();

  if (!db) {
    return NextResponse.json({ count: fallbackVisits, durable: false });
  }

  await ensureCounterTable(db);

  const rows = await db`
    SELECT count
    FROM site_counters
    WHERE name = 'site_visits'
  `;

  return NextResponse.json({ count: Number(rows[0]?.count ?? 0), durable: true });
}

export async function POST() {
  const db = getDatabase();

  if (!db) {
    fallbackVisits += 1;
    return NextResponse.json({ count: fallbackVisits, durable: false });
  }

  await ensureCounterTable(db);

  const rows = await db`
    INSERT INTO site_counters (name, count)
    VALUES ('site_visits', 1)
    ON CONFLICT (name)
    DO UPDATE SET count = site_counters.count + 1
    RETURNING count
  `;

  return NextResponse.json({ count: Number(rows[0]?.count ?? 0), durable: true });
}

async function ensureCounterTable(db: NonNullable<ReturnType<typeof getDatabase>>) {
  await db`
    CREATE TABLE IF NOT EXISTS site_counters (
      name text PRIMARY KEY,
      count integer NOT NULL DEFAULT 0
    )
  `;
}
