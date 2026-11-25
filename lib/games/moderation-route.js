// The owner's moderation requests, inside the GameRooms object. The site's
// games route checks the owner's sign-in and passes the server secret in
// `x-moderation-key`; the object never answers these without it.
//
// GET  .../moderation           {cases, sanctions}
// POST .../moderation           {do: "act", case, action} | {do: "lift", player}
//                               | {do: "ignore", reporter, name, on}

export const MODERATION_HEADER = "x-moderation-key";

function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function moderationRoute(request, moderation, secret) {
  if (!secret || secret.length < 32 || !same(request.headers.get(MODERATION_HEADER) ?? "", secret)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (request.method === "GET") {
    return Response.json({ ok: true, cases: moderation.cases(), sanctions: moderation.sanctions() });
  }
  if (request.method !== "POST") return Response.json({ error: "bad-request" }, { status: 405 });
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad-request" }, { status: 400 });
  }
  switch (body?.do) {
    case "act": {
      const outcome = moderation.act(body.case, body.action);
      if (!outcome) return Response.json({ error: "no-such-case" }, { status: 404 });
      return Response.json({ ok: true, outcome });
    }
    case "lift":
      if (typeof body.player !== "string") break;
      moderation.lift(body.player);
      return Response.json({ ok: true });
    case "ignore":
      if (typeof body.reporter !== "string") break;
      moderation.ignore(body.reporter, String(body.name ?? ""), Boolean(body.on));
      return Response.json({ ok: true });
  }
  return Response.json({ error: "bad-request" }, { status: 400 });
}
