import { afterEach, describe, expect, test, vi } from "vitest";

const request = (headers: Record<string, string>) => new Request("https://orinks.net/api/x", { headers });

describe("clientIp", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  test("takes the first X-Forwarded-For entry off Workers and ignores CF-Connecting-IP", async () => {
    const { clientIp } = await import("./client-ip");
    expect(clientIp(request({ "x-forwarded-for": "203.0.113.5, 10.0.0.1", "cf-connecting-ip": "198.51.100.9" }))).toBe(
      "203.0.113.5",
    );
    expect(clientIp(request({}))).toBeNull();
  });

  test("trusts CF-Connecting-IP on Workers, where the first X-Forwarded-For entry is client-supplied", async () => {
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    const { clientIp } = await import("./client-ip");
    expect(clientIp(request({ "x-forwarded-for": "1.2.3.4, 198.51.100.9", "cf-connecting-ip": "198.51.100.9" }))).toBe(
      "198.51.100.9",
    );
  });
});
