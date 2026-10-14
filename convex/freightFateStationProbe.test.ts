import { createServer, type Server } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { describeProbe, probeStream, probeWith } from "./freightFateStationVetting";

// A stand-in for the internet: one raw TCP server that answers by path, so
// the probe's own HTTP/1.0 reader is what is under test, Shoutcast v1's
// "ICY 200 OK" included.
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(2048, 0x55)]);

function reply(path: string, port: number): Buffer | null {
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
    case "/list.m3u":
      return Buffer.concat([
        head("HTTP/1.1 200 OK", ["Content-Type: audio/x-mpegurl"]),
        Buffer.from(`#EXTM3U\n#EXTINF:-1,One\nhttp://stream.test:${port}/icy\n#EXTINF:-1,Two\nhttp://stream.test:${port}/live\n`),
      ]);
    case "/hls/master.m3u8":
      return Buffer.concat([
        head("HTTP/1.1 200 OK", ["Content-Type: application/vnd.apple.mpegurl"]),
        Buffer.from("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=64000\nlow/index.m3u8\n"),
      ]);
    case "/hls/low/index.m3u8":
      return Buffer.concat([
        head("HTTP/1.1 200 OK", ["Content-Type: application/vnd.apple.mpegurl"]),
        Buffer.from("#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nseg1.aac\n"),
      ]);
    case "/hls/low/seg1.aac":
      return Buffer.concat([head("HTTP/1.1 200 OK", ["Content-Type: audio/aac"]), Buffer.alloc(2048, 0xff)]);
    case "/hls/dead.m3u8":
      return Buffer.concat([
        head("HTTP/1.1 200 OK", ["Content-Type: application/vnd.apple.mpegurl"]),
        Buffer.from("#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\ngone.aac\n"),
      ]);
    case "/forbidden":
      return head("HTTP/1.1 403 Forbidden", []);
    case "/silent":
      return null;
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
      const answer = reply(path, port);
      // Silence: the connection stays open with nothing said until the probe gives up.
      if (answer) socket.end(answer);
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
const probe = (path: string, budget = 10_000) =>
  probeWith(`http://stream.test:${port}${path}`, local, 0, Date.now() + budget);
const at = (path: string) => `http://stream.test:${port}${path}`;

describe("probeStream", () => {
  test("hears a Shoutcast v1 server and a plain HTTP stream", async () => {
    expect(await probe("/icy")).toEqual({ ok: true, format: "mp3", name: "Test", playUrl: at("/icy") });
    expect(await probe("/live")).toEqual({ ok: true, format: "aac+", playUrl: at("/live") });
  });

  test("follows a redirect and a playlist one level", async () => {
    expect(await probe("/moved")).toEqual({ ok: true, format: "aac+", playUrl: at("/live") });
    expect(await probe("/station.pls")).toEqual({ ok: true, format: "mp3", name: "Test", playUrl: at("/icy") });
    expect(await probe("/loop.pls")).toEqual({ ok: false, reason: "stream_not_audio" });
  });

  test("hands back the stations a playlist of several lists", async () => {
    expect(await probe("/list.m3u")).toEqual({
      ok: false,
      reason: "stream_station_list",
      stations: [
        { name: "One", streamUrl: `http://stream.test:${port}/icy` },
        { name: "Two", streamUrl: `http://stream.test:${port}/live` },
      ],
    });
  });

  test("names what went wrong", async () => {
    expect(await probe("/page")).toEqual({ ok: false, reason: "stream_web_page" });
    expect(await probe("/short")).toEqual({ ok: false, reason: "stream_unreachable", problem: "too_little_audio" });
    expect(await probe("/missing")).toEqual({ ok: false, reason: "stream_unreachable", problem: "http_404" });
    expect(await probe("/forbidden")).toEqual({ ok: false, reason: "stream_unreachable", problem: "http_403" });
    expect(await probe("/silent", 300)).toEqual({ ok: false, reason: "stream_unreachable", problem: "no_reply" });
    expect(await probeWith("http://nowhere.test/", local, 0, Date.now() + 1000)).toEqual({
      ok: false,
      reason: "stream_unreachable",
      problem: "no_address",
    });
  });

  test("hears HLS only when a segment answers, through a master playlist", async () => {
    expect(await probe("/hls/master.m3u8")).toEqual({ ok: true, format: "hls", playUrl: at("/hls/master.m3u8") });
    expect(await probe("/hls/dead.m3u8")).toEqual({ ok: false, reason: "stream_unreachable", problem: "http_404" });
  });

  test("tells the reviewer what each failure means", async () => {
    expect(describeProbe(await probe("/hls/master.m3u8"))).toBe("Plays (HLS)");
    expect(describeProbe(await probe("/forbidden"))).toBe(
      "Fails: the server refused it (error 403). Some stations refuse listeners outside their country",
    );
    expect(describeProbe(await probe("/missing"))).toBe(
      "Fails: the server has no stream at this address (error 404), so it is probably dead",
    );
  });

  test("never connects to a private address", async () => {
    expect(await probeStream(`http://127.0.0.1:${port}/icy`)).toEqual({ ok: false, reason: "stream_address_blocked" });
    expect(await probeStream(`http://localhost:${port}/icy`)).toEqual({ ok: false, reason: "stream_address_blocked" });
    expect(await probeStream("http://[::1]/")).toEqual({ ok: false, reason: "stream_address_blocked" });
  });
});
