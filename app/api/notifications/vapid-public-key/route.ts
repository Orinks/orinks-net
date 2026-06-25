import { NextResponse } from "next/server";
import { getBuildNotificationPublicKey } from "@/lib/notifications";

export function GET() {
  const publicKey = getBuildNotificationPublicKey();

  if (!publicKey) {
    return NextResponse.json({ error: "Notifications are not configured." }, { status: 503 });
  }

  return NextResponse.json({ publicKey });
}
