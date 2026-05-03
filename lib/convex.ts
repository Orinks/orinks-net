import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;

export function getConvexClient() {
  if (!convexUrl) {
    return null;
  }

  return new ConvexHttpClient(convexUrl);
}

export async function getVisitCount() {
  const client = getConvexClient();

  if (!client) {
    return null;
  }

  return client.query(anyApi.visits.getVisitCount, {});
}

export async function incrementVisitCount() {
  const client = getConvexClient();

  if (!client) {
    return null;
  }

  return client.mutation(anyApi.visits.incrementVisitCount, {});
}
