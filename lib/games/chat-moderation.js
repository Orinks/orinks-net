// Chat moderation for a game's rooms: the `screen`, `report` and
// `standing` hooks Hearken's rooms service takes (lib/hearken-online,
// docs/online.md in orinks-games/hearken), and the owner's page of cases.
//
// Everything lives in the GameRooms Durable Object's SQLite beside the
// rooms (lib/games/rooms-store.js): no Convex call is made on a chat line,
// a report or a pulse. Each game has its own object, so nothing here is
// keyed by game.
//
// Three explicit state machines, logged as `[moderation] ...`:
//
// A case: every open report about one player.
//
// | State | Means | Leaves when |
// |---|---|---|
// | open | At least one report, nobody has looked | Three accounts within a day: auto. The owner acts: closed |
// | auto | Chat off for a day, waiting for the owner | The owner acts: closed. The day passes: open |
// | closed | Dismissed, warned, or chat off 1 day, 7 days or for good | Never; a new report starts a new case |
//
// A sanction, per player:
//
// | State | Means | Leaves when |
// |---|---|---|
// | clear | May chat (no row) | Warn: warned. A timed chat-off: off until a time. A ban: off for good |
// | warned | Hears the warning once, on the next pulse | Heard: clear (the warning stays on the case) |
// | off until a time | Typed and ready lines refused | The time passes, or Dismiss: clear |
// | off for good | Same | Only the owner: clear |
//
// The screen's own short chat-off, kept in memory: five screened lines in
// ten minutes turn a player's chat off for ten minutes.
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from "obscenity";
import { isNameBlocked } from "../../convex/moderation";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const LIMITS = {
  /** Distinct accounts whose reports within a day turn chat off. */
  autoReporters: 3,
  autoWindowMs: DAY,
  autoOffMs: DAY,
  /** The automatic step fires at most this often per player until the owner looks. */
  autoEveryMs: 7 * DAY,
  screenedLines: 5,
  screenedWindowMs: 10 * MINUTE,
  screenedOffMs: 10 * MINUTE,
  /** One email for new cases at most this often. */
  emailEveryMs: HOUR,
  /** Lines copied into a report are kept this long after the case closes. */
  keepReportsMs: 90 * DAY,
  keepCasesMs: 365 * DAY,
};

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS chat_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    about_id TEXT NOT NULL,
    about_handle TEXT NOT NULL,
    about_name TEXT NOT NULL,
    state TEXT NOT NULL,
    outcome TEXT,
    opened_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    auto_at INTEGER,
    closed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS chat_cases_about ON chat_cases (about_id, state)`,
  `CREATE TABLE IF NOT EXISTS chat_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL,
    about_id TEXT NOT NULL,
    reporter_id TEXT NOT NULL,
    reporter_name TEXT NOT NULL,
    counts INTEGER NOT NULL,
    at INTEGER NOT NULL,
    data TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS chat_reports_case ON chat_reports (case_id)`,
  `CREATE INDEX IF NOT EXISTS chat_reports_about ON chat_reports (about_id, at)`,
  `CREATE TABLE IF NOT EXISTS chat_sanctions (
    player_id TEXT PRIMARY KEY,
    handle TEXT NOT NULL,
    name TEXT NOT NULL,
    chat TEXT NOT NULL,
    until INTEGER,
    message TEXT,
    reason TEXT NOT NULL,
    at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chat_ignored (
    reporter_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chat_mail (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    at INTEGER NOT NULL
  )`,
];

/** What the owner can do to a case, as the page names it. */
export const ACTIONS = {
  dismiss: { outcome: "dismissed" },
  warn: { outcome: "warned" },
  "off-day": { outcome: "chat off for a day", offMs: DAY, message: "Your chat is off for a day." },
  "off-week": { outcome: "chat off for 7 days", offMs: 7 * DAY, message: "Your chat is off for 7 days." },
  "off-good": { outcome: "chat off for good", offMs: null, message: "Your chat is off." },
};

export const WARNING = "A warning about your chat. Chat rules: be kind, no personal details, 16 and over.";
export const NOT_SENT = "That line was not sent.";

const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

/** A line the word list turns away: profanity and slurs, then hate words one word at a time. */
export function hasBlockedWords(text) {
  if (matcher.hasMatch(text)) return true;
  // One word at a time, so letters across two words never make one.
  return text.split(/\s+/).some((word) => word.length >= 3 && isNameBlocked(word));
}

const LINK = /https?:\/\/|\bwww\.|\b[a-z0-9-]+\s?(?:\.|\bdot\b)\s?(?:com|net|org|io|gg|me|co|tv|xyz|info|ly|app|dev|uk|us|ru|link|site|online)\b/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const DIGITS = /(?:\d[\s.()-]*){7,}/;

/** Personal details and ways off the site: a link, an email address, a phone-length run of digits. */
export function hasContact(text) {
  return LINK.test(text) || EMAIL.test(text) || DIGITS.test(text);
}

/** The line a player hears when their chat is off. */
export function offLine(until, t) {
  if (until === null || until === undefined) return "Your chat is off.";
  const left = until - t;
  if (left <= 30 * MINUTE) return "Your chat is off for a few minutes.";
  if (left <= DAY) return "Your chat is off until tomorrow.";
  return `Your chat is off for ${Math.ceil(left / DAY)} more days.`;
}

/**
 * The hooks and the owner's view over `sql` (anything with
 * `exec(query, ...bindings)` answering a cursor with `toArray()`).
 * `mail(subject, text)` sends the owner an email; `log(line)` notes each
 * state change.
 */
export function chatModeration(sql, { now = () => Date.now(), mail = null, log = () => {}, pageUrl = null } = {}) {
  for (const statement of SCHEMA) sql.exec(statement);
  const rows = (query, ...bindings) => sql.exec(query, ...bindings).toArray();
  // The screen's memory: recent screened lines and sent lines per player,
  // and short chat-offs. Lost when the object sleeps, which is fine: each
  // lasts minutes.
  const screened = new Map(); // player id -> times
  const sent = new Map(); // player id -> last texts
  const shortOff = new Map(); // player id -> until
  let prunedAt = 0;

  function note(line) {
    log(`[moderation] ${line}`);
  }

  function sanctionOf(playerId, t) {
    const row = rows(`SELECT * FROM chat_sanctions WHERE player_id = ?`, String(playerId))[0];
    if (!row) return null;
    if (row.chat === "off" && row.until !== null && Number(row.until) <= t) {
      sql.exec(`DELETE FROM chat_sanctions WHERE player_id = ?`, String(playerId));
      note(`sanction ${row.handle}: off until a time -> clear (time passed)`);
      return null;
    }
    return { ...row, until: row.until === null ? null : Number(row.until) };
  }

  function setSanction(about, { chat, until = null, message = null, reason }, t) {
    const before = sanctionOf(about.id, t);
    sql.exec(
      `INSERT INTO chat_sanctions (player_id, handle, name, chat, until, message, reason, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (player_id) DO UPDATE SET handle = excluded.handle, name = excluded.name, chat = excluded.chat,
         until = excluded.until, message = excluded.message, reason = excluded.reason, at = excluded.at`,
      String(about.id),
      about.handle,
      about.name,
      chat,
      until,
      message,
      reason,
      t,
    );
    const name = chat === "warned" ? "warned" : until === null ? "off for good" : "off until a time";
    note(`sanction ${about.handle}: ${sanctionName(before)} -> ${name} (${reason})`);
  }

  function clearSanction(playerId, why, t) {
    const before = sanctionOf(playerId, t);
    if (!before) return;
    sql.exec(`DELETE FROM chat_sanctions WHERE player_id = ?`, String(playerId));
    note(`sanction ${before.handle}: ${sanctionName(before)} -> clear (${why})`);
  }

  function setCase(row, state, fields, t) {
    const sets = ["state = ?", "updated_at = ?"];
    const values = [state, t];
    for (const [k, v] of Object.entries(fields)) {
      sets.push(`${k} = ?`);
      values.push(v);
    }
    sql.exec(`UPDATE chat_cases SET ${sets.join(", ")} WHERE id = ?`, ...values, row.id);
    if (row.state !== state) note(`case ${row.id}: ${row.state} -> ${state}`);
  }

  /** An auto case whose day has passed goes back to open. */
  function settle(t) {
    for (const row of rows(`SELECT * FROM chat_cases WHERE state = 'auto'`)) {
      if (Number(row.auto_at) + LIMITS.autoOffMs <= t) setCase(row, "open", {}, t);
    }
  }

  function prune(t) {
    if (t - prunedAt < HOUR) return;
    prunedAt = t;
    sql.exec(
      `UPDATE chat_reports SET data = NULL WHERE data IS NOT NULL AND case_id IN
         (SELECT id FROM chat_cases WHERE state = 'closed' AND closed_at < ?)`,
      t - LIMITS.keepReportsMs,
    );
    const old = rows(`SELECT id FROM chat_cases WHERE state = 'closed' AND closed_at < ?`, t - LIMITS.keepCasesMs);
    for (const { id } of old) {
      sql.exec(`DELETE FROM chat_reports WHERE case_id = ?`, id);
      sql.exec(`DELETE FROM chat_cases WHERE id = ?`, id);
    }
  }

  async function tellOwner(row, t) {
    if (!mail) return;
    const last = rows(`SELECT at FROM chat_mail WHERE id = 1`)[0];
    if (last && t - Number(last.at) < LIMITS.emailEveryMs) return;
    sql.exec(`INSERT INTO chat_mail (id, at) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET at = excluded.at`, t);
    const open = rows(`SELECT COUNT(*) AS n FROM chat_cases WHERE state != 'closed'`)[0]?.n ?? 1;
    const text = [
      `${row.about_name} was reported in chat.`,
      `${open} ${Number(open) === 1 ? "case is" : "cases are"} open.`,
      pageUrl ? `Review them: ${pageUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await mail(`Chat report: ${row.about_name}`, text);
    } catch (error) {
      log(`[moderation] the report email failed: ${String(error)}`);
    }
  }

  return {
    /** The `screen` hook: false or a line refuses a chat line. */
    screen({ text, quick, player }) {
      const t = now();
      prune(t);
      const sanction = sanctionOf(player.id, t);
      if (sanction?.chat === "off") return { code: "chat-off", message: offLine(sanction.until, t) };
      const short = shortOff.get(player.id);
      if (short && short > t) return { code: "chat-off", message: offLine(short, t) };
      // A ready line is one the game offers: nothing in it to check.
      if (quick) return true;
      if (player.guest) return false;
      const last = sent.get(player.id) ?? [];
      const repeated = last.length >= 2 && last.slice(-2).every((l) => l === text.toLowerCase());
      if (hasBlockedWords(text) || hasContact(text) || repeated) {
        const times = (screened.get(player.id) ?? []).filter((at) => t - at < LIMITS.screenedWindowMs);
        times.push(t);
        screened.set(player.id, times);
        if (times.length >= LIMITS.screenedLines) {
          screened.delete(player.id);
          shortOff.set(player.id, t + LIMITS.screenedOffMs);
          note(`screen ${player.id}: ${LIMITS.screenedLines} screened lines -> chat off for ten minutes`);
          return { code: "chat-off", message: offLine(t + LIMITS.screenedOffMs, t) };
        }
        return false;
      }
      sent.set(player.id, [...last, text.toLowerCase()].slice(-2));
      return true;
    },

    /** The `report` hook: one case per player, the automatic step, one email. */
    async report(report) {
      const t = now();
      settle(t);
      prune(t);
      const { reporter, about } = report;
      let row = rows(`SELECT * FROM chat_cases WHERE about_id = ? AND state != 'closed' ORDER BY id DESC LIMIT 1`, String(about.id))[0];
      const fresh = !row;
      if (fresh) {
        sql.exec(
          `INSERT INTO chat_cases (about_id, about_handle, about_name, state, opened_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?)`,
          String(about.id),
          about.handle,
          about.name,
          t,
          t,
        );
        row = rows(`SELECT * FROM chat_cases WHERE id = last_insert_rowid()`)[0];
        note(`case ${row.id}: none -> open (${about.handle})`);
      }
      const ignored = rows(`SELECT 1 AS x FROM chat_ignored WHERE reporter_id = ?`, String(reporter.id)).length > 0;
      const counts = !reporter.guest && !ignored;
      sql.exec(
        `INSERT INTO chat_reports (case_id, about_id, reporter_id, reporter_name, counts, at, data) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        String(about.id),
        String(reporter.id),
        reporter.name,
        counts ? 1 : 0,
        t,
        JSON.stringify({
          kind: report.room?.kind ?? null,
          room: report.room?.id ?? null,
          lines: report.lines ?? [],
          context: report.context ?? [],
          marked: report.marked ?? null,
          note: report.note ?? null,
        }),
      );
      sql.exec(`UPDATE chat_cases SET updated_at = ?, about_name = ? WHERE id = ?`, t, about.name, row.id);
      // The automatic step: three accounts within a day, at most once a
      // week per player until the owner has looked.
      const reporters = rows(
        `SELECT COUNT(DISTINCT reporter_id) AS n FROM chat_reports WHERE about_id = ? AND counts = 1 AND at > ?`,
        String(about.id),
        t - LIMITS.autoWindowMs,
      )[0].n;
      if (row.state === "open" && Number(reporters) >= LIMITS.autoReporters) {
        const lastAuto = rows(`SELECT MAX(auto_at) AS at FROM chat_cases WHERE about_id = ?`, String(about.id))[0]?.at;
        const looked = rows(
          `SELECT 1 AS x FROM chat_cases WHERE about_id = ? AND state = 'closed' AND closed_at > ?`,
          String(about.id),
          Number(lastAuto ?? 0),
        ).length > 0;
        const current = sanctionOf(about.id, t);
        if ((lastAuto === null || lastAuto === undefined || t - Number(lastAuto) >= LIMITS.autoEveryMs || looked) && current?.chat !== "off") {
          setCase(row, "auto", { auto_at: t }, t);
          setSanction(about, { chat: "off", until: t + LIMITS.autoOffMs, message: "Your chat is off for a day.", reason: "auto" }, t);
        }
      }
      if (fresh) await tellOwner(row, t);
    },

    /** The `standing` hook: the player's sanction, its message heard once. */
    standing(player) {
      const t = now();
      const s = sanctionOf(player.id, t);
      const short = shortOff.get(player.id);
      if (!s) return short && short > t ? { chat: "off", until: short } : null;
      const out = { chat: s.chat === "off" ? "off" : "open", ...(s.until !== null ? { until: s.until } : {}), ...(s.message ? { message: s.message } : {}) };
      if (s.chat === "warned") {
        clearSanction(player.id, "warning heard", t);
      } else if (s.message) {
        sql.exec(`UPDATE chat_sanctions SET message = NULL WHERE player_id = ?`, String(player.id));
      }
      return out;
    },

    /** The owner's page: cases still to look at, newest first, then the last closed ones. */
    cases({ closed = 20 } = {}) {
      const t = now();
      settle(t);
      const list = [
        ...rows(`SELECT * FROM chat_cases WHERE state != 'closed' ORDER BY updated_at DESC`),
        ...rows(`SELECT * FROM chat_cases WHERE state = 'closed' ORDER BY closed_at DESC LIMIT ?`, closed),
      ];
      const ignored = new Set(rows(`SELECT reporter_id FROM chat_ignored`).map((r) => r.reporter_id));
      return list.map((c) => {
        const reports = rows(`SELECT * FROM chat_reports WHERE case_id = ? ORDER BY at`, c.id).map((r) => ({
          id: Number(r.id),
          reporter: { id: r.reporter_id, name: r.reporter_name, ignored: ignored.has(r.reporter_id) },
          counts: Boolean(r.counts),
          at: Number(r.at),
          ...(r.data ? JSON.parse(r.data) : { lines: [], context: [], marked: null, note: null, kind: null }),
        }));
        const past = rows(
          `SELECT id, outcome, closed_at FROM chat_cases WHERE about_id = ? AND id != ? AND state = 'closed' ORDER BY closed_at DESC LIMIT 10`,
          c.about_id,
          c.id,
        ).map((p) => ({ id: Number(p.id), outcome: p.outcome, closedAt: Number(p.closed_at) }));
        const sanction = sanctionOf(c.about_id, t);
        return {
          id: Number(c.id),
          about: { id: c.about_id, handle: c.about_handle, name: c.about_name },
          state: c.state,
          outcome: c.outcome,
          openedAt: Number(c.opened_at),
          updatedAt: Number(c.updated_at),
          closedAt: c.closed_at === null ? null : Number(c.closed_at),
          sanction: sanction ? { chat: sanction.chat, until: sanction.until, reason: sanction.reason } : null,
          reports,
          past,
        };
      });
    },

    /** Players whose chat is off now, for the page's list. */
    sanctions() {
      const t = now();
      return rows(`SELECT player_id FROM chat_sanctions WHERE chat = 'off'`)
        .map((r) => sanctionOf(r.player_id, t))
        .filter(Boolean)
        .map((s) => ({ id: s.player_id, handle: s.handle, name: s.name, until: s.until, reason: s.reason }));
    },

    /** The owner acts on a case. Answers the case's new outcome, or null for no such open case. */
    act(caseId, action) {
      const t = now();
      settle(t);
      const what = ACTIONS[action];
      const row = rows(`SELECT * FROM chat_cases WHERE id = ?`, Number(caseId))[0];
      if (!what || !row || row.state === "closed") return null;
      const about = { id: row.about_id, handle: row.about_handle, name: row.about_name };
      if (action === "dismiss") {
        const s = sanctionOf(about.id, t);
        if (s?.reason === "auto") clearSanction(about.id, "dismissed", t);
      } else if (action === "warn") {
        const s = sanctionOf(about.id, t);
        if (s?.reason === "auto") clearSanction(about.id, "warned instead", t);
        if (!sanctionOf(about.id, t)) setSanction(about, { chat: "warned", message: WARNING, reason: "owner" }, t);
      } else {
        setSanction(about, { chat: "off", until: what.offMs === null ? null : t + what.offMs, message: what.message, reason: "owner" }, t);
      }
      setCase(row, "closed", { outcome: what.outcome, closed_at: t }, t);
      return what.outcome;
    },

    /** Turns a player's chat back on. */
    lift(playerId) {
      clearSanction(playerId, "owner lifted it", now());
    },

    /** Marks a reporter whose reports stop counting, or undoes it. */
    ignore(reporterId, name, on) {
      if (on) {
        sql.exec(`INSERT OR IGNORE INTO chat_ignored (reporter_id, name, at) VALUES (?, ?, ?)`, String(reporterId), String(name), now());
        sql.exec(`UPDATE chat_reports SET counts = 0 WHERE reporter_id = ?`, String(reporterId));
      } else {
        sql.exec(`DELETE FROM chat_ignored WHERE reporter_id = ?`, String(reporterId));
      }
    },
  };
}

function sanctionName(s) {
  if (!s) return "clear";
  if (s.chat === "warned") return "warned";
  return s.until === null ? "off for good" : "off until a time";
}
