// The caller's address, as the platform in front of the site saw it.
//
// On Vercel the first X-Forwarded-For entry is the one its edge saw. On
// Cloudflare Workers that entry can be whatever the client sent (Cloudflare
// appends the real address after it), so the address comes from
// CF-Connecting-IP instead. That header is only trusted on Workers: anywhere
// else a client could set it.
const onWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

export function clientIp(request: Request): string | null {
  if (onWorkers) {
    const connecting = request.headers.get("cf-connecting-ip")?.trim();
    if (connecting) return connecting;
  }
  return (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null;
}
