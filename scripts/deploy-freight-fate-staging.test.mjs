import { describe, expect, it } from "vitest";

import {
  classifyVercelBuild,
  convexDeployArgs,
  isTransientConvexFailure,
} from "./deploy-freight-fate-staging.mjs";

describe("Freight Fate Vercel backend deployment policy", () => {
  it("deploys the fixed staging backend for Vercel's dev branch", () => {
    expect(classifyVercelBuild({ branch: "dev", hasDeployKey: true })).toEqual({
      deployBackend: true,
      target: "staging",
      reason: "dev uses fixed staging backend",
    });
    expect(classifyVercelBuild({ branch: "feature/profile-copy", hasDeployKey: false })).toEqual({
      deployBackend: false,
      reason: "ordinary frontend preview",
    });
  });

  it("deploys the production backend for main", () => {
    expect(classifyVercelBuild({ branch: "main", hasDeployKey: true })).toEqual({
      deployBackend: true,
      target: "production",
      reason: "main deploys the production backend",
    });
  });

  it("refuses to publish dev without its fixed backend key", () => {
    expect(() => classifyVercelBuild({ branch: "dev", hasDeployKey: false })).toThrow(
      "dev is missing its Convex staging deploy key",
    );
  });

  it("refuses to publish main's frontend without deploying its backend", () => {
    // The failure this guards: the site ships, Vercel goes green, and the
    // Convex functions behind it are a release behind.
    expect(() => classifyVercelBuild({ branch: "main", hasDeployKey: false })).toThrow(
      "main is missing its Convex production deploy key",
    );
  });

  it("retries transport failures but not invalid application modules", () => {
    expect(isTransientConvexFailure("Request failed with status code 408")).toBe(true);
    expect(isTransientConvexFailure("HTTP status 503 from deployment service")).toBe(true);
    expect(isTransientConvexFailure("InvalidModules: Cannot read properties of undefined")).toBe(
      false,
    );
    expect(isTransientConvexFailure("Unauthorized: invalid deploy key")).toBe(false);
  });

  it("explicitly acknowledges the intentional production-class staging target", () => {
    expect(convexDeployArgs("staging")).toContain("--check-build-environment");
    expect(convexDeployArgs("staging")).toContain("disable");
  });

  it("keeps the build-environment guard on for a real production deploy", () => {
    expect(convexDeployArgs("production")).not.toContain("--check-build-environment");
    expect(convexDeployArgs("production")).toContain("deploy");
    expect(convexDeployArgs("production")).toContain("NEXT_PUBLIC_CONVEX_URL");
  });

});
