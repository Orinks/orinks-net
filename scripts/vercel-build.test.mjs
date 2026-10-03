import { describe, expect, it } from "vitest";

import {
  classifyVercelBuild,
  convexDeployArgs,
  isTransientConvexFailure,
} from "./vercel-build.mjs";

describe("Vercel build: which branches deploy Convex", () => {
  it("builds dev and every other branch as an ordinary preview, key or not", () => {
    for (const branch of ["dev", "feature/profile-copy"]) {
      for (const hasDeployKey of [true, false]) {
        expect(classifyVercelBuild({ branch, hasDeployKey })).toEqual({
          deployBackend: false,
          reason: "ordinary frontend preview",
        });
      }
    }
  });

  it("deploys the production backend for main", () => {
    expect(classifyVercelBuild({ branch: "main", hasDeployKey: true })).toEqual({
      deployBackend: true,
      target: "production",
      reason: "main deploys the production backend",
    });
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

  it("keeps Convex's build-environment guard on for the production deploy", () => {
    expect(convexDeployArgs()).not.toContain("--check-build-environment");
    expect(convexDeployArgs()).toContain("deploy");
    expect(convexDeployArgs()).toContain("NEXT_PUBLIC_CONVEX_URL");
  });

});
