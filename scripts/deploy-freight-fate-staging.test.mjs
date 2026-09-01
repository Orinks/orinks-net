import { describe, expect, it } from "vitest";

import {
  classifyStagingRun,
  isTransientConvexFailure,
} from "./deploy-freight-fate-staging.mjs";

describe("temporary Freight Fate staging deployment policy", () => {
  it("deploys only an enabled push to dev", () => {
    expect(
      classifyStagingRun({
        enabled: "true",
        eventName: "push",
        ref: "refs/heads/dev",
      }),
    ).toEqual({ deploy: true, reason: "enabled dev push" });

    expect(
      classifyStagingRun({
        enabled: "true",
        eventName: "push",
        ref: "refs/heads/feature/profile-copy",
      }),
    ).toEqual({ deploy: false, reason: "not the dev branch" });
  });

  it("stays disabled after the temporary staging period", () => {
    expect(
      classifyStagingRun({
        enabled: "false",
        eventName: "push",
        ref: "refs/heads/dev",
      }),
    ).toEqual({ deploy: false, reason: "temporary staging is disabled" });
  });

  it("retries transport failures but not invalid application modules", () => {
    expect(isTransientConvexFailure("Request failed with status code 408")).toBe(true);
    expect(isTransientConvexFailure("HTTP status 503 from deployment service")).toBe(true);
    expect(isTransientConvexFailure("InvalidModules: Cannot read properties of undefined")).toBe(
      false,
    );
    expect(isTransientConvexFailure("Unauthorized: invalid deploy key")).toBe(false);
  });
});
