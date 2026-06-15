import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
const siteTimeZone = "America/New_York";

export type VisitCounts = {
  lifetime: number;
  today: number;
  environmentKey: string;
  todayKey: string;
};

function sanitizeEnvironmentKey(value: string | undefined, fallback = "local") {
  const sanitized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return sanitized || fallback;
}

export function getVisitorCounterEnvironment() {
  const configuredEnvironment = sanitizeEnvironmentKey(process.env.VISITOR_COUNTER_ENV, "");

  if (configuredEnvironment) {
    return configuredEnvironment;
  }

  const vercelEnvironment = process.env.VERCEL_ENV?.toLowerCase();
  const branch = sanitizeEnvironmentKey(process.env.VERCEL_GIT_COMMIT_REF, "");

  if (vercelEnvironment === "production") {
    return "production";
  }

  if (vercelEnvironment === "preview") {
    return branch === "dev" ? "preview-dev" : sanitizeEnvironmentKey(`preview-${branch}`, "preview");
  }

  if (vercelEnvironment === "development") {
    return "local";
  }

  return "local";
}

export function getVisitorTodayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: siteTimeZone,
    year: "numeric",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

function getVisitCounterContext() {
  return {
    environmentKey: getVisitorCounterEnvironment(),
    todayKey: getVisitorTodayKey(),
  };
}

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

  const context = getVisitCounterContext();
  const counts = await client.query(anyApi.visits.getVisitCount, context);

  return { ...counts, ...context } as VisitCounts;
}

export async function incrementVisitCount() {
  const client = getConvexClient();

  if (!client) {
    return null;
  }

  const context = getVisitCounterContext();
  const counts = await client.mutation(anyApi.visits.incrementVisitCount, context);

  return { ...counts, ...context } as VisitCounts;
}
