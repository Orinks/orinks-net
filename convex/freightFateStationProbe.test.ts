import { createServer, type Server } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { probeStream, probeWith } from "./freightFateStationVetting";

// A stand-in for the internet: one raw TCP server that answers by path, so
// the probe's own HTTP/1.0 reader is what is under test, Shoutcast v1's
// "ICY 200 OK" included.
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(2048, 0x55)]);

function reply(path: string, port: number) {
  const head = (status: string, headers: string[]) => Buffer.from(`${status}\r\n${headers.join("\r\n")}\r\n\r\n`);
  switch (path) {
    case "/icy":
      return Buffer.concat([head("ICY 200 OK", ["icy-name: Test", "content-type: audio/mpeg"]), MP3]);
    case "/live":
      return Buffer.concat([head("HTTP/1.0 200 OK", ["Content-Type: audio/aacp"]), Buffer.alloc(2048, 0xff)]);
    case "/moved":
      return head("HTTP/1.1 302 Found", [`Location: http://stream.test:${port}/live`]);
    case "/station.pls":
      return Buffer.concat([
        head("HTTP/1.1 200 OK", ["Content-Type: audio/x-scpls"]),
        Buffer.from(`[playlist]\nFile1=http://stream.test:${port}/icy\n`),
      ]);
    case "/loop.pls":
      return Buffer.concat([
        head("HTTP/1.1 200 OK", ["Content-Type: audio/x-scpls"]),
        Buffer.from(`[playlist]\nFile1=http://stream.test:${port}/loop.pls\n`),
      ]);
    case "/page":
      return Buffer.concat([head("HTTP/1.1 200 OK", ["Content-Type: text/html"]), Buffer.from("<!doctype html><p>Listen live!</p>")]);
    case "/short":
      return Buffer.concat([head("HTTP/1.1 200 OK", ["Content-Type: audio/mpeg"]), Buffer.from("ID3")]);
    default:
      return head("HTTP/1.1 404 Not Found", []);
  }
}

let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((socket) => {
    socket.once("data", (data) => {
      const path = /^GET (\S+)/.exec(data.toString("latin1"))?.[1] ?? "/";
      socket.end(reply(path, port));
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(() => {
  server.close();
});

const local = async (hostname: string) =>
  hostname === "stream.test" ? { blocked: false, address: "127.0.0.1" } : { blocked: false, address: null };
const probe = (path: string) => probeWith(`http://stream.test:${port}${path}`, local, 0, Date.now() + 10_000);

describe("probeStream", () => {
  test("hears a Shoutcast v1 server and a plain HTTP stream", async () => {
    expect(await probe("/icy")).toEqual({ ok: true, format: "mp3" });
    expect(await probe("/live")).toEqual({ ok: true, format: "aac+" });
  });

  test("follows a redirect and a playlist one level", async () => {
    expect(await probe("/moved")).toEqual({ ok: true, format: "aac+" });
    expect(await probe("/station.pls")).toEqual({ ok: true, format: "mp3" });
    expect(await probe("/loop.pls")).toEqual({ ok: false, reason: "stream_not_audio" });
  });

  test("names what went wrong", async () => {
    expect(await probe("/page")).toEqual({ ok: false, reason: "stream_web_page" });
    expect(await probe("/short")).toEqual({ ok: false, reason: "stream_unreachable" });
    expect(await probe("/missing")).toEqual({ ok: false, reason: "stream_unreachable" });
  });

  test("never connects to a private address", async () => {
    expect(await probeStream(`http://127.0.0.1:${port}/icy`)).toEqual({ ok: false, reason: "stream_address_blocked" });
    expect(await probeStream(`http://localhost:${port}/icy`)).toEqual({ ok: false, reason: "stream_address_blocked" });
    expect(await probeStream("http://[::1]/")).toEqual({ ok: false, reason: "stream_address_blocked" });
  });
});
