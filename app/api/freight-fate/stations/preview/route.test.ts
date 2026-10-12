import { createServer, type Server } from "node:net";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

// The stand-in stream lives on 127.0.0.1, which the real rule refuses.
let publicAddresses = true;
vi.mock("@/convex/freightFateStationRules", () => ({ isPublicAddress: () => publicAddresses }));

const { GET } = await import("./route");

const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(4096, 0x55)]);

let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((socket) => {
    socket.once("data", (data) => {
      const path = /^GET (\S+)/.exec(data.toString("latin1"))?.[1] ?? "/";
      const head = (status: string, headers: string[]) => Buffer.from(`${status}\r\n${headers.join("\r\n")}\r\n\r\n`);
      if (path === "/icy") socket.end(Buffer.concat([head("ICY 200 OK", ["content-type: audio/mpeg"]), MP3]));
      else if (path === "/moved") socket.end(head("HTTP/1.1 302 Found", [`Location: http://127.0.0.1:${port}/icy`, "Content-Length: 0"]));
      else if (path === "/page") socket.end(Buffer.concat([head("HTTP/1.1 200 OK", ["Content-Type: text/html"]), Buffer.from("<p>hi</p>")]));
      else socket.end(head("HTTP/1.1 404 Not Found", ["Content-Length: 0"]));
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(() => {
  server.close();
});

const preview = (path: string) =>
  GET(new Request(`https://orinks.net/api/freight-fate/stations/preview?url=${encodeURIComponent(`http://127.0.0.1:${port}${path}`)}`));

describe("station preview", () => {
  test("passes a Shoutcast stream through, after a redirect too", async () => {
    for (const path of ["/icy", "/moved"]) {
      const response = await preview(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("audio/mpeg");
      expect(Buffer.from(await response.arrayBuffer()).subarray(0, 3).toString()).toBe("ID3");
    }
  });

  test("refuses anything that is not audio", async () => {
    expect((await preview("/page")).status).toBe(502);
    expect((await preview("/missing")).status).toBe(502);
  });

  test("never connects to a private address", async () => {
    publicAddresses = false;
    expect((await preview("/icy")).status).toBe(502);
    publicAddresses = true;
  });
});
