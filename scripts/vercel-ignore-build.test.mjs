import { describe, expect, test } from "vitest";
import { shouldBuild } from "./vercel-ignore-build.mjs";

describe("which branches Vercel builds", () => {
  test("main and dev build", () => {
    expect(shouldBuild("main")).toBe(true);
    expect(shouldBuild("dev")).toBe(true);
  });

  test("every other branch is skipped", () => {
    for (const branch of ["claude/project-thread-xbh602", "codex/public-music-download", "feat/presence-prod", "devin/1791481800-dispatch-page", "main-backup", "develop"]) {
      expect(shouldBuild(branch)).toBe(false);
    }
  });

  test("a deployment with no branch is built", () => {
    expect(shouldBuild("")).toBe(true);
    expect(shouldBuild(undefined)).toBe(true);
  });
});
