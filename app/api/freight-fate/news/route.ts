import { NextResponse } from "next/server";
import { PAPER_CHROME, readPaperEdition } from "@/lib/freight-fate-paper-page";
import { paperSpeech } from "@/lib/freight-fate-paper-speech";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The driver newspaper as the game reads it aloud: the latest published
// issue, or one past issue with ?issue=N. It goes through the same
// five-minute cached read as /freight-fate/news, so it costs the backend
// nothing the page did not already pay for, and a driver who turns Profile
// sharing off leaves it as soon as they leave the page. Nothing about the
// caller is read. Not found while FREIGHT_FATE_PAPER is off or no issue is
// published; the game keeps whatever issue it already holds.
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("issue");
  let issue: number | undefined;
  if (raw !== null) {
    if (!/^[1-9]\d{0,5}$/.test(raw)) return notFound();
    issue = Number(raw);
  }
  const read = await readPaperEdition(issue);
  if (!read.ok) {
    return NextResponse.json({ error: "The paper can't be read right now." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  if (!read.value) return notFound();
  return NextResponse.json(paperSpeech(read.value, PAPER_CHROME, { latest: issue === undefined }), {
    headers: { "cache-control": "no-store" },
  });
}

function notFound() {
  return NextResponse.json({ error: "No issue." }, { status: 404, headers: { "cache-control": "no-store" } });
}
