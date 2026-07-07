import { NextResponse } from "next/server";
import {
  confirmFreightFateSetup,
  normalizeFreightFateDisplayName,
  normalizeFreightFateToken,
  normalizeFreightFateVisibility,
} from "@/lib/freight-fate-online";

export const runtime = "nodejs";

function setupRedirect(request: Request, token: string, status: string) {
  const url = new URL("/freight-fate/online/setup", request.url);
  url.searchParams.set("token", token);
  url.searchParams.set("status", status);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const rawToken = formData.get("setupToken");
  const rawDisplayName = formData.get("displayName");
  const rawVisibility = formData.get("visibility");

  try {
    const setupToken = normalizeFreightFateToken(rawToken, "Setup token");
    const displayName = normalizeFreightFateDisplayName(rawDisplayName, "Freight Fate Driver");
    const visibility = normalizeFreightFateVisibility(rawVisibility);
    const result = await confirmFreightFateSetup({ setupToken, displayName, visibility });

    if (!result) {
      return setupRedirect(request, setupToken, "not-configured");
    }

    if (!result.ok) {
      return setupRedirect(request, setupToken, result.reason);
    }

    return NextResponse.redirect(new URL(`/freight-fate/drivers/${result.driverId}?setup=confirmed`, request.url), 303);
  } catch {
    const token = typeof rawToken === "string" ? rawToken : "";

    return setupRedirect(request, token, "invalid");
  }
}
