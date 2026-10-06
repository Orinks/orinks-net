import { describe, expect, it } from "vitest";
import { FREIGHT_FATE_CHANNEL_3000_PACK_URL } from "@/lib/freight-fate-downloads";
import { GET } from "./route";

describe("GET /downloads/channel3000.pak", () => {
  it("redirects the stable path to permanent here.now storage", async () => {
    const response = await GET();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(FREIGHT_FATE_CHANNEL_3000_PACK_URL);
    expect(new URL(FREIGHT_FATE_CHANNEL_3000_PACK_URL).hostname).toBe("crisp-crystal-9a9y.here.now");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  });
});
