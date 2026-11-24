// GameRooms: one Durable Object per Hearken game, holding its rooms
// (matches and chat between players) in the object's own SQLite.
//
// The site's games route hands every /api/games/<game>/rooms request here
// (app/api/games/[game]/[...path]/route.ts). The object runs the game's
// service with the rooms store over `ctx.storage.sql`, one request at a
// time (`oneAtATime` in rooms-store.js): a request reads a room, changes
// it and saves it, and nothing else touches that room in between.
//
// Only the Workers build has this file: worker/index.js exports the class,
// and cloudflare.config.ts declares it with SQLite storage.
import { DurableObject } from "cloudflare:workers";
import { oneAtATime, sqlRooms } from "./rooms-store.js";
import { roomsServiceFor } from "./service";

export class GameRooms extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.store = null;
    this.games = new Map();
  }

  serve(game, origin) {
    this.store ??= sqlRooms(this.ctx.storage.sql);
    if (!this.games.has(game)) {
      const service = roomsServiceFor(game, origin, this.store);
      this.games.set(game, service ? oneAtATime(this.store, service, service.warm) : null);
    }
    return this.games.get(game);
  }

  async fetch(request) {
    const url = new URL(request.url);
    // /api/games/<game>/rooms...
    const game = url.pathname.split("/")[3] ?? "";
    const serve = this.serve(game, url.origin);
    if (!serve) return Response.json({ error: "unavailable" }, { status: 503 });
    return serve(request);
  }
}
