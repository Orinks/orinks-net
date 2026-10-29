import { describe, expect, test } from "vitest";
import { GET, POST } from "./route";

const params = (game: string) => ({ params: Promise.resolve({ game, path: ["runs"] }) });

describe("/api/games/[game]", () => {
  test("a game the site does not run is not found", async () => {
    const res = await POST(new Request("https://orinks.net/api/games/nope/runs?kind=x", { method: "POST" }), params("nope"));
    expect(res.status).toBe(404);
    expect((await GET(new Request("https://orinks.net/api/games/__proto__/x"), params("__proto__"))).status).toBe(404);
  });
});
