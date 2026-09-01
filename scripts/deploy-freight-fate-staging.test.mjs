import { describe, expect, it } from "vitest";

import {
  classifyVercelBuild,
  convexDeployArgs,
  isTransientConvexFailure,
} from "./deploy-freight-fate-staging.mjs";

describe("temporary Freight Fate staging deployment policy", () => {
  it("deploys the fixed backend only for Vercel's dev branch", () => {
    expect(classifyVercelBuild({ branch: "dev", hasDeployKey: true })).toEqual({
      deployBackend: true,
      reason: "dev uses fixed staging backend",
    });
    expect(classifyVercelBuild({ branch: "feature/profile-copy", hasDeployKey: false })).toEqual({
      deployBackend: false,
      reason: "ordinary frontend preview",
    });
  });

  it("refuses to publish dev without its fixed backend key", () => {
    expect(() => classifyVercelBuild({ branch: "dev", hasDeployKey: false })).toThrow(
      "dev is missing its Convex staging deploy key",
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
    expect(convexDeployArgs()).toContain("--check-build-environment");
    expect(convexDeployArgs()).toContain("disable");
  });

});
