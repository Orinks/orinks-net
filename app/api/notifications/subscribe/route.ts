import { NextResponse } from "next/server";
import { removeBuildSubscription, saveBuildSubscription } from "@/lib/notifications";

export const runtime = "nodejs";

function isSubscription(value: unknown): value is {
  endpoint: string;
  expirationTime?: number | null;
  keys: { auth: string; p256dh: string };
  product: string;
} {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Record<string, unknown>;
  const keys = body.keys as Record<string, unknown> | undefined;

  return (
    typeof body.endpoint === "string" &&
    typeof body.product === "string" &&
    (!("expirationTime" in body) ||
      typeof body.expirationTime === "number" ||
      body.expirationTime === null) &&
    Boolean(keys) &&
    typeof keys?.auth === "string" &&
    typeof keys?.p256dh === "string"
  );
}

export async function POST(request: Request) {
  const body = (await request.json()) as unknown;

  if (!isSubscription(body)) {
    return NextResponse.json({ error: "Subscription details are invalid." }, { status: 400 });
  }

  const saved = await saveBuildSubscription(body);

  if (!saved) {
    return NextResponse.json({ error: "Notifications are not configured." }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const body = (await request.json()) as unknown;

  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as Record<string, unknown>).endpoint !== "string" ||
    typeof (body as Record<string, unknown>).product !== "string"
  ) {
    return NextResponse.json({ error: "Subscription details are invalid." }, { status: 400 });
  }

  const removed = await removeBuildSubscription(
    (body as { endpoint: string }).endpoint,
    (body as { product: string }).product,
  );

  if (!removed) {
    return NextResponse.json({ error: "Notifications are not configured." }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
