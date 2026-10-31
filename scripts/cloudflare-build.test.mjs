import { describe, expect, it } from "vitest";

import {
  classifyCloudflareBuild,
  convexDeployArgs,
  parseArgs,
  workerDeployArgs,
} from "./cloudflare-build.mjs";

describe("Cloudflare build: when Convex is deployed", () => {
  it("never deploys Convex for the preview Worker, key or not", () => {
    for (const hasDeployKey of [true, false]) {
      expect(classifyCloudflareBuild({ target: "preview", hasDeployKey })).toMatchObject({
        deployBackend: false,
        mode: "preview",
      });
    }
  });

  it("deploys the production backend with the production Worker", () => {
    expect(classifyCloudflareBuild({ target: "production", hasDeployKey: true })).toMatchObject({
      deployBackend: true,
      mode: "production",
    });
  });

  it("refuses to publish the production Worker without deploying its backend", () => {
    expect(() => classifyCloudflareBuild({ target: "production", hasDeployKey: false })).toThrow(
      "production is missing its Convex production deploy key",
    );
  });

  it("builds production locally without a deploy key when only building", () => {
    expect(
      classifyCloudflareBuild({ target: "production", hasDeployKey: false, buildOnly: true }),
    ).toMatchObject({ deployBackend: false, mode: "production" });
  });

  it("builds the Worker inside convex deploy so it gets the production Convex URL", () => {
    expect(convexDeployArgs("production")).toEqual([
      "convex",
      "deploy",
      "--typecheck",
      "try",
      "--cmd-url-env-var-name",
      "NEXT_PUBLIC_CONVEX_URL",
      "--cmd",
      "npx vite build --mode production",
    ]);
    expect(workerDeployArgs("production")).toEqual([
      "vinext-cloudflare",
      "deploy",
      "--skip-build",
      "--env",
      "production",
    ]);
  });

  it("requires an explicit target", () => {
    expect(() => parseArgs([])).toThrow("--target");
    expect(() => parseArgs(["--target", "staging"])).toThrow("--target");
    expect(parseArgs(["--target=preview", "--build-only"])).toEqual({
      target: "preview",
      buildOnly: true,
    });
  });
});
