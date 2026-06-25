import type { PushSubscription } from "web-push";
import { anyApi } from "convex/server";
import { getConvexClient } from "@/lib/convex";

export type BuildSubscriptionInput = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    auth: string;
    p256dh: string;
  };
  product: string;
};

export function getBuildNotificationPublicKey() {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
}

export async function saveBuildSubscription(subscription: BuildSubscriptionInput) {
  const client = getConvexClient();

  if (!client) {
    return null;
  }

  return client.mutation(anyApi.notifications.saveBuildSubscription, {
    ...subscription,
    expirationTime: subscription.expirationTime ?? undefined,
  });
}

export async function removeBuildSubscription(endpoint: string, product: string) {
  const client = getConvexClient();

  if (!client) {
    return null;
  }

  return client.mutation(anyApi.notifications.removeBuildSubscription, { endpoint, product });
}

export async function listBuildSubscriptions(product?: string) {
  const client = getConvexClient();

  if (!client) {
    return null;
  }

  return client.query(anyApi.notifications.listBuildSubscriptions, { product }) as Promise<
    Array<PushSubscription & { _id: string; product: string }>
  >;
}
