// GameRooms: one Durable Object per Hearken game, holding its rooms
// (matches and chat between players) in the object's own SQLite, and the
// chat moderation beside them (lib/games/chat-moderation.js).
//
// The site's games route hands every /api/games/<game>/rooms request here
// (app/api/games/[game]/[...path]/route.ts), and the owner's moderation
// requests as /api/games/<game>/moderation, once it has checked the owner's
// sign-in. The object runs the game's service with the rooms store over
// `ctx.storage.sql`, one request at a time (`oneAtATime` in
// rooms-store.js): a request reads a room, changes it and saves it, and
// nothing else touches that room in between.
//
// Only the Workers build has this file: worker/index.js exports the class,
// and cloudflare.config.ts declares it with SQLite storage.
import { DurableObject } from "cloudflare:workers";
import { chatModeration } from "./chat-moderation.js";
import { moderationRoute } from "./moderation-route.js";
import { oneAtATime, sqlRooms } from "./rooms-store.js";
import { roomsServiceFor } from "./service";
import { site } from "../site";

export class GameRooms extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.store = null;
    this.moderation = null;
    this.games = new Map();
  }

  parts() {
    this.store ??= sqlRooms(this.ctx.storage.sql);
    this.moderation ??= chatModeration(this.ctx.storage.sql, {
      mail: ownerMail(),
      log: (line) => console.warn("games", line),
      pageUrl: `${site.url}/games/moderation`,
    });
    return { store: this.store, moderation: this.moderation };
  }

  serve(game, origin) {
    const { store, moderation } = this.parts();
    if (!this.games.has(game)) {
      const hooks = {
        screen: (input) => moderation.screen(input),
        report: (report) => moderation.report(report),
        standing: (player) => moderation.standing(player),
      };
      const service = roomsServiceFor(game, origin, store, hooks);
      this.games.set(game, service ? oneAtATime(store, service, service.warm) : null);
    }
    return this.games.get(game);
  }

  async fetch(request) {
    const url = new URL(request.url);
    // /api/games/<game>/rooms... or /api/games/<game>/moderation
    const parts = url.pathname.split("/");
    const game = parts[3] ?? "";
    if (parts[4] === "moderation") {
      return moderationRoute(request, this.parts().moderation, process.env.GAMES_SERVER_SECRET);
    }
    const serve = this.serve(game, url.origin);
    if (!serve) return Response.json({ error: "unavailable" }, { status: 503 });
    return serve(request);
  }
}

/** Sends the owner an email through the mailer problem reports use, or null without one. */
function ownerMail() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.CONTACT_FROM_EMAIL;
  const to = process.env.CONTACT_TO_EMAIL;
  if (!apiKey || !from || !to) return null;
  return async (subject, text) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text }),
    });
    if (!response.ok) throw new Error(`resend answered ${response.status}`);
  };
}
