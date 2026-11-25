// Hearken's rooms (matches and chat between players) kept in SQLite: the
// storage of the GameRooms Durable Object (lib/games/rooms-object.js), or
// node:sqlite in the tests. It keeps every guarantee memoryRooms() in
// lib/hearken-online/rooms.js lists:
//
// - `append` gives one `seq` per event, in order, with no gaps. The room's
//   seq lives in its own column and only `append` moves it, so a `save` of
//   a room read before an append never winds it back.
// - `create` keeps a code unique among rooms that are not over, and a
//   named channel unique for its kind.
// - `save` writes the room record as a whole. The Durable Object runs one
//   request at a time, so a read, change and save is never interleaved.
// - `prune` drops old events and keeps the numbering.
// - Invites and friends (the lobby) are rows of their own; presence lives
//   in the object's memory.
//
// `sql` is anything with `exec(query, ...bindings)` answering a cursor with
// `toArray()`, as `ctx.storage.sql` does.
import { FINAL_PHASES, mintRoomCode } from "../hearken-online/index.js";

const FINAL = FINAL_PHASES.map((p) => `'${p}'`).join(", ");

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT,
    phase TEXT NOT NULL,
    open INTEGER NOT NULL DEFAULT 0,
    direct INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    seq INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS rooms_code ON rooms (code, phase)`,
  `CREATE INDEX IF NOT EXISTS rooms_kind ON rooms (kind, phase, created_at)`,
  `CREATE TABLE IF NOT EXISTS members (
    room_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    PRIMARY KEY (room_id, player_id)
  )`,
  `CREATE INDEX IF NOT EXISTS members_player ON members (player_id)`,
  `CREATE TABLE IF NOT EXISTS events (
    room_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    at INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (room_id, seq)
  )`,
  `CREATE TABLE IF NOT EXISTS players (
    handle TEXT PRIMARY KEY,
    data TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS mutes (
    player_id TEXT NOT NULL,
    player_handle TEXT NOT NULL,
    handle TEXT NOT NULL,
    them_id TEXT,
    mode TEXT NOT NULL,
    PRIMARY KEY (player_id, handle)
  )`,
  `CREATE INDEX IF NOT EXISTS mutes_them ON mutes (them_id, mode)`,
  // The lobby: invites to a match, and one-sided friends. Presence is not
  // stored; the service keeps it in the object's memory.
  `CREATE TABLE IF NOT EXISTS invites (
    id TEXT PRIMARY KEY,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    data TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS invites_from ON invites (from_id, at)`,
  `CREATE INDEX IF NOT EXISTS invites_to ON invites (to_id, at)`,
  `CREATE TABLE IF NOT EXISTS friends (
    player_id TEXT NOT NULL,
    handle TEXT NOT NULL,
    PRIMARY KEY (player_id, handle)
  )`,
];

function randomId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * The rooms store over `sql`.
 *
 * The service holds on to a room it read while it appends to it, and reads
 * `room.seq` afterwards (memoryRooms hands out the stored object itself, so
 * it sees the new seq). Each room read here is remembered until the next
 * `forget()`, the start of the next request, and `append` moves its seq.
 */
export function sqlRooms(sql) {
  for (const statement of SCHEMA) sql.exec(statement);
  const rows = (query, ...bindings) => sql.exec(query, ...bindings).toArray();
  const live = new Map(); // id -> the room objects handed out this request

  function hand(row) {
    if (!row) return null;
    const room = { ...JSON.parse(row.data), id: row.id, seq: Number(row.seq) };
    const list = live.get(room.id) ?? [];
    list.push(room);
    live.set(room.id, list);
    return room;
  }

  function write(room, { insert = false } = {}) {
    const { seq: _seq, id, ...rest } = room;
    const data = JSON.stringify(rest);
    const values = [
      room.kind,
      room.code,
      room.name ?? null,
      room.phase,
      room.open ? 1 : 0,
      room.direct ? 1 : 0,
      Number(room.createdAt ?? 0),
      Number(room.updatedAt ?? 0),
      data,
    ];
    if (insert) {
      sql.exec(
        `INSERT INTO rooms (kind, code, name, phase, open, direct, created_at, updated_at, data, id, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        ...values,
        id,
      );
    } else {
      sql.exec(
        `UPDATE rooms SET kind = ?, code = ?, name = ?, phase = ?, open = ?, direct = ?,
           created_at = ?, updated_at = ?, data = ? WHERE id = ?`,
        ...values,
        id,
      );
    }
    sql.exec(`DELETE FROM members WHERE room_id = ?`, id);
    for (const m of room.members ?? []) {
      sql.exec(`INSERT OR IGNORE INTO members (room_id, player_id) VALUES (?, ?)`, id, String(m.id));
    }
  }

  function codeTaken(code) {
    return rows(`SELECT 1 AS x FROM rooms WHERE code = ? AND phase NOT IN (${FINAL}) LIMIT 1`, code).length > 0;
  }

  return {
    /** Forget the rooms handed out so far: a new request begins. */
    forget() {
      live.clear();
    },

    async create(room) {
      const id = randomId();
      let code = room.code;
      while (!code || codeTaken(code)) code = mintRoomCode();
      const made = { ...room, id, code, seq: 0 };
      write(made, { insert: true });
      const list = live.get(id) ?? [];
      list.push(made);
      live.set(id, list);
      return made;
    },

    async get(id) {
      return hand(rows(`SELECT * FROM rooms WHERE id = ?`, String(id))[0]);
    },

    async save(room) {
      write(room);
    },

    async byCode(code) {
      return hand(rows(`SELECT * FROM rooms WHERE code = ? AND phase NOT IN (${FINAL}) LIMIT 1`, code)[0]);
    },

    async byName(kind, name) {
      return hand(
        rows(`SELECT * FROM rooms WHERE kind = ? AND name = ? AND phase NOT IN (${FINAL}) LIMIT 1`, kind, name)[0],
      );
    },

    async directBetween(kind, a, b) {
      const found = rows(
        `SELECT r.* FROM rooms r
           JOIN members ma ON ma.room_id = r.id AND ma.player_id = ?
           JOIN members mb ON mb.room_id = r.id AND mb.player_id = ?
         WHERE r.kind = ? AND r.direct = 1 AND r.phase NOT IN (${FINAL})`,
        String(a),
        String(b),
        kind,
      );
      for (const row of found) {
        const room = JSON.parse(row.data);
        if ((room.members ?? []).length === 2) return hand(row);
      }
      return null;
    },

    async listFor(playerId) {
      return rows(
        `SELECT r.* FROM rooms r JOIN members m ON m.room_id = r.id
         WHERE m.player_id = ? ORDER BY r.updated_at DESC`,
        String(playerId),
      ).map(hand);
    },

    async openRooms(kind) {
      return rows(
        `SELECT * FROM rooms WHERE kind = ? AND open = 1 AND phase = 'waiting' ORDER BY created_at ASC`,
        kind,
      ).map(hand);
    },

    async append(id, event) {
      const found = rows(`UPDATE rooms SET seq = seq + 1 WHERE id = ? RETURNING seq`, String(id))[0];
      if (!found) throw new Error("no such room");
      const seq = Number(found.seq);
      sql.exec(
        `INSERT INTO events (room_id, seq, at, data) VALUES (?, ?, ?, ?)`,
        String(id),
        seq,
        Number(event.at ?? 0),
        JSON.stringify({ ...event, seq }),
      );
      for (const room of live.get(String(id)) ?? []) room.seq = seq;
      return seq;
    },

    async eventsAfter(id, seq, limit = 500) {
      return rows(
        `SELECT data FROM events WHERE room_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
        String(id),
        Number(seq) || 0,
        limit,
      ).map((r) => JSON.parse(r.data));
    },

    async eventsBefore(id, seq, limit = 500) {
      const found =
        seq === null || seq === undefined
          ? rows(`SELECT data FROM events WHERE room_id = ? ORDER BY seq DESC LIMIT ?`, String(id), limit)
          : rows(
              `SELECT data FROM events WHERE room_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?`,
              String(id),
              Number(seq),
              limit,
            );
      return found.map((r) => JSON.parse(r.data)).reverse();
    },

    async prune(id, beforeAt) {
      sql.exec(`DELETE FROM events WHERE room_id = ? AND at < ?`, String(id), Number(beforeAt));
    },

    async rememberPlayer(player) {
      const data = JSON.stringify({
        id: player.id,
        name: player.name,
        guest: Boolean(player.guest),
        handle: player.handle,
      });
      sql.exec(
        `INSERT INTO players (handle, data) VALUES (?, ?)
         ON CONFLICT (handle) DO UPDATE SET data = excluded.data`,
        player.handle,
        data,
      );
    },

    async playerByHandle(handle) {
      const row = rows(`SELECT data FROM players WHERE handle = ?`, String(handle))[0];
      return row ? JSON.parse(row.data) : null;
    },

    async relations(playerId) {
      const mine = rows(`SELECT handle, mode FROM mutes WHERE player_id = ?`, String(playerId));
      const against = rows(`SELECT player_handle FROM mutes WHERE them_id = ? AND mode = 'block'`, String(playerId));
      return {
        muted: new Set(mine.filter((r) => r.mode === "mute").map((r) => r.handle)),
        blocked: new Set(mine.filter((r) => r.mode === "block").map((r) => r.handle)),
        blockedBy: new Set(against.map((r) => r.player_handle)),
      };
    },

    async saveInvite(invite) {
      sql.exec(
        `INSERT INTO invites (id, from_id, to_id, at, data) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
        invite.id,
        String(invite.from.id),
        String(invite.to.id),
        Number(invite.at ?? 0),
        JSON.stringify(invite),
      );
    },

    async getInvite(id) {
      const row = rows(`SELECT data FROM invites WHERE id = ?`, String(id))[0];
      return row ? JSON.parse(row.data) : null;
    },

    async invitesFor(playerId) {
      return rows(
        `SELECT data FROM invites WHERE from_id = ? OR to_id = ? ORDER BY at DESC LIMIT 200`,
        String(playerId),
        String(playerId),
      ).map((r) => JSON.parse(r.data));
    },

    async dropInvite(id) {
      sql.exec(`DELETE FROM invites WHERE id = ?`, String(id));
    },

    async setFriend(playerId, handle, on) {
      if (on) {
        sql.exec(`INSERT OR IGNORE INTO friends (player_id, handle) VALUES (?, ?)`, String(playerId), handle);
      } else {
        sql.exec(`DELETE FROM friends WHERE player_id = ? AND handle = ?`, String(playerId), handle);
      }
    },

    async friendsOf(playerId) {
      return rows(`SELECT handle FROM friends WHERE player_id = ? ORDER BY handle`, String(playerId)).map((r) => r.handle);
    },

    async setMute(player, handle, mode, them) {
      if (mode === "none") {
        sql.exec(`DELETE FROM mutes WHERE player_id = ? AND handle = ?`, String(player.id), handle);
        return;
      }
      sql.exec(
        `INSERT INTO mutes (player_id, player_handle, handle, them_id, mode) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (player_id, handle) DO UPDATE SET mode = excluded.mode,
           them_id = COALESCE(excluded.them_id, mutes.them_id), player_handle = excluded.player_handle`,
        String(player.id),
        player.handle,
        handle,
        them ? String(them.id) : null,
        mode,
      );
    },
  };
}

/**
 * Runs a service's requests one at a time over `store`, as the GameRooms
 * Durable Object does: each request reads, changes and saves its rooms
 * with nothing else in between. `warm(token)` runs first, outside the
 * line, so a slow account lookup holds up no one else.
 */
export function oneAtATime(store, service, warm = async () => {}) {
  let queue = Promise.resolve();
  return async (request) => {
    const auth = request.headers.get("authorization") ?? "";
    if (auth.toLowerCase().startsWith("bearer ")) {
      await warm(auth.slice(7).trim()).catch(() => {});
    }
    const turn = queue.then(() => {
      store.forget();
      return service.fetch(request);
    });
    // The next request waits for this one, whatever it answered.
    queue = turn.catch(() => {});
    return turn;
  };
}
