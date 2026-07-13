import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import webPush from "web-push";
import { githubReleasesCacheTag } from "@/lib/github";
import { listBuildSubscriptions, removeBuildSubscription } from "@/lib/notifications";

export const runtime = "nodejs";

type SendBody = {
  body?: string;
  product?: string;
  title?: string;
  url?: string;
};

function hasSendToken(request: Request) {
  const configuredToken = process.env.BUILD_NOTIFICATION_TOKEN;
  const header = request.headers.get("authorization");

  return Boolean(configuredToken && header && header === `Bearer ${configuredToken}`);
}

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:notifications@orinks.net";

  if (!publicKey || !privateKey) {
    return false;
  }

  webPush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

export async function POST(request: Request) {
  if (!hasSendToken(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as SendBody;
  const product = body.product?.trim();

  if (!product) {
    return NextResponse.json({ error: "A product is required." }, { status: 400 });
  }

  revalidateTag(githubReleasesCacheTag);

  if (!configureWebPush()) {
    return NextResponse.json({ error: "Web Push is not configured." }, { status: 503 });
  }

  const subscriptions = await listBuildSubscriptions(product);

  if (!subscriptions) {
    return NextResponse.json({ error: "Notifications are not configured." }, { status: 503 });
  }

  const payload = JSON.stringify({
    body: body.body || `A new ${product} build is available.`,
    product,
    sentAt: Date.now(),
    title: body.title || `${product} build available`,
    url: body.url || `/${product.toLowerCase().replace(/[^a-z0-9]+/g, "-")}/downloads`,
  });

  const results = await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      try {
        await webPush.sendNotification(subscription, payload);
        return "sent";
      } catch (error) {
        const statusCode =
          typeof error === "object" && error && "statusCode" in error
            ? Number((error as { statusCode: unknown }).statusCode)
            : 0;

        if (statusCode === 404 || statusCode === 410) {
          await removeBuildSubscription(subscription.endpoint, subscription.product);
          return "removed";
        }

        throw error;
      }
    }),
  );

  const sent = results.filter(
    (result) => result.status === "fulfilled" && result.value === "sent",
  ).length;
  const removed = results.filter(
    (result) => result.status === "fulfilled" && result.value === "removed",
  ).length;
  const failed = results.filter((result) => result.status === "rejected").length;

  return NextResponse.json({ failed, removed, sent });
}
