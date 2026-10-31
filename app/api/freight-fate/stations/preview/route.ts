import { lookup } from "node:dns/promises";
import { isIP, Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { dechunk, isPublicAddress, previewPlayable } from "@/convex/freightFateStationRules";
import { absolutePlaylist } from "@/lib/hls-playlist";

export const runtime = "nodejs";
export const maxDuration = 40;

// A short listen to a station picked from a playlist on the suggestion form.
// The page is https and most streams are plain http, which a browser refuses
// to play inside it, so the audio comes through here: only from a public
// address, only audio, and only for a preview's worth. Raw sockets, like the
// suggestion check's probe, because Node's HTTP client rejects a Shoutcast v1
// server's "ICY 200 OK".
//
// An HLS station comes through here a piece at a time: the page plays it
// with hls.js, which asks for each playlist and segment by its own address.
// A playlist goes back with every address in it pointed through this route,
// so each piece comes from the site whether hls.js or Safari asks for it.
const PREVIEW_SECONDS = 25;
const PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 8_000;
const MAX_HEAD_BYTES = 16 * 1024;
const MAX_REDIRECTS = 5;
const MAX_PLAYLIST_BYTES = 256 * 1024;
const HLS_PLAYLIST = /^(application\/(vnd\.apple\.mpegurl|x-mpegurl)|audio\/(x-)?mpegurl)$/;

/** The first public address the host resolves to, or null when any is private. */
async function publicAddress(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0 || !addresses.every((entry) => isPublicAddress(entry.address))) return null;
  return addresses[0].address;
}

const onWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

type Reply = { status: number; headers: Map<string, string>; socket: Socket; rest: Buffer };

/** One GET to the address that was checked, read up to the end of its head. */
function open(url: URL, address: string) {
  return new Promise<Reply | null>((resolve) => {
    const secure = url.protocol === "https:";
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const port = Number(url.port) || (secure ? 443 : 80);
    // On Cloudflare Workers, node:tls checks the certificate against the host
    // it dials and ignores `servername`, so dialing the checked address fails
    // every https stream with a name mismatch. There the hostname is dialed
    // instead; a Worker cannot reach private networks in any case, so the
    // public-address check above still stands for what it guards.
    const tlsHost = onWorkers && !isIP(host) ? host : address;
    const socket: Socket = secure
      ? tlsConnect({ host: tlsHost, port, servername: isIP(host) ? undefined : host })
      : new Socket().connect(port, address);
    let head = Buffer.alloc(0);
    const fail = () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(null);
    };
    const timer = setTimeout(fail, CONNECT_TIMEOUT_MS);
    socket.once(secure ? "secureConnect" : "connect", () => {
      socket.write(
        `GET ${url.pathname || "/"}${url.search} HTTP/1.0\r\nHost: ${url.host}\r\n` +
          "User-Agent: FreightFate-StationPreview/1 (+https://orinks.net/freight-fate)\r\n" +
          "Icy-MetaData: 0\r\nAccept: */*\r\nConnection: close\r\n\r\n",
      );
    });
    const onData = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const split = head.indexOf("\r\n\r\n");
      const end = split === -1 ? head.indexOf("\n\n") : split;
      if (end === -1) {
        if (head.length > MAX_HEAD_BYTES) fail();
        return;
      }
      clearTimeout(timer);
      socket.off("data", onData);
      socket.pause();
      const lines = head.subarray(0, end).toString("latin1").split(/\r?\n/);
      const status = /^(?:HTTP\/\d(?:\.\d)?|ICY)\s+(\d{3})/i.exec(lines[0] ?? "");
      if (!status) return fail();
      const headers = new Map<string, string>();
      for (const line of lines.slice(1)) {
        const colon = line.indexOf(":");
        if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
      }
      resolve({ status: Number(status[1]), headers, socket, rest: head.subarray(end + (split === -1 ? 2 : 4)) });
    };
    socket.on("data", onData);
    socket.once("error", fail);
    socket.once("close", fail);
  });
}

/**
 * The rest of a small reply, or null past MAX_PLAYLIST_BYTES or a slow
 * server. It ends at Content-Length, or when the server closes, which a CDN
 * may do without a clean TLS end.
 */
function readAll({ socket, rest, headers }: Reply) {
  return new Promise<string | null>((resolve) => {
    const chunks = [rest];
    let total = rest.length;
    let settled = false;
    const length = Number(headers.get("content-length"));
    const chunked = /chunked/i.test(headers.get("transfer-encoding") ?? "");
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (!ok) return resolve(null);
      const body = Buffer.concat(chunks);
      resolve(Buffer.from(chunked ? dechunk(body) : body).toString("utf8"));
    };
    const timer = setTimeout(() => done(false), CONNECT_TIMEOUT_MS);
    const enough = () => length > 0 && !chunked && total >= length;
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total > MAX_PLAYLIST_BYTES) done(false);
      else if (enough()) done(true);
    });
    socket.once("end", () => done(true));
    socket.once("close", () => done(total > 0));
    socket.once("error", () => done(total > 0));
    if (enough()) return done(true);
    socket.resume();
  });
}

const previewPath = (address: string) => `/api/freight-fate/stations/preview?url=${encodeURIComponent(address)}`;

/** A refusal, with why in a header the page reads to say why a preview did not play. */
const refused = (status: number, problem?: string) => {
  if (problem) console.warn(`Station preview: ${problem}`);
  return new Response(null, {
    status,
    headers: { "cache-control": "no-store", ...(problem ? { "x-preview-problem": problem } : {}) },
  });
};

export async function GET(request: Request) {
  let url: URL;
  try {
    url = new URL(new URL(request.url).searchParams.get("url") ?? "");
  } catch {
    return refused(400);
  }

  let reply: Reply | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (url.protocol !== "http:" && url.protocol !== "https:") break;
    const address = await publicAddress(url.hostname);
    if (!address) break;
    reply = await open(url, address);
    const location = reply?.headers.get("location");
    if (!reply || !location || reply.status < 300 || reply.status >= 400) break;
    reply.socket.destroy();
    reply = null;
    try {
      url = new URL(location, url);
    } catch {
      break;
    }
  }

  const type = (reply?.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!reply || reply.status !== 200) {
    reply?.socket.destroy();
    return refused(502, reply ? `the station's server answered with error ${reply.status}` : "the station's server did not answer");
  }
  // A playlist served as anything but a playlist type still starts #EXTM3U.
  if (HLS_PLAYLIST.test(type) || (reply.rest.length > 0 && reply.rest.subarray(0, 7).toString("latin1") === "#EXTM3U")) {
    const text = await readAll(reply);
    if (text === null || !text.trimStart().startsWith("#EXTM3U")) {
      return refused(502, "the station's playlist could not be read");
    }
    return new Response(absolutePlaylist(text, url, previewPath), {
      headers: { "cache-control": "no-store", "content-type": "application/vnd.apple.mpegurl" },
    });
  }
  if (!previewPlayable(type)) {
    reply.socket.destroy();
    return refused(502, `the station's server sent ${type || "something"} instead of audio`);
  }

  const { socket, rest } = reply;
  let sent = 0;
  let stop: ReturnType<typeof setTimeout> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(stream) {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(stop);
        socket.destroy();
        stream.close();
      };
      const send = (chunk: Buffer) => {
        if (done || chunk.length === 0) return;
        sent += chunk.length;
        stream.enqueue(new Uint8Array(chunk));
        if (sent >= PREVIEW_MAX_BYTES) finish();
      };
      stop = setTimeout(finish, PREVIEW_SECONDS * 1000);
      request.signal.addEventListener("abort", finish);
      send(rest);
      socket.on("data", send);
      socket.once("end", finish);
      socket.once("close", finish);
      socket.once("error", finish);
      socket.resume();
    },
    cancel() {
      clearTimeout(stop);
      socket.destroy();
    },
  });

  return new Response(body, { headers: { "cache-control": "no-store", "content-type": type } });
}
