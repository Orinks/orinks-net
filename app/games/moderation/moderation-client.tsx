"use client";

import { useUser } from "@clerk/nextjs";
import { useAction, useConvexAuth } from "convex/react";
import { useCallback, useEffect, useId, useState } from "react";
import { AccountControls } from "@/components/AccountControls";
import { Section } from "@/components/Section";
import { api } from "@/convex/_generated/api";

type Game = { id: string; title: string };

type Line = { seq: number; name?: string; text?: string; at: number };

export type Report = {
  id: number;
  reporter: { id: string; name: string; ignored: boolean };
  counts: boolean;
  at: number;
  kind: string | null;
  lines: Line[];
  context: Line[];
  marked: Line | null;
  note: string | null;
};

export type Case = {
  id: number;
  about: { id: string; handle: string; name: string };
  state: "open" | "auto" | "closed";
  outcome: string | null;
  openedAt: number;
  closedAt: number | null;
  sanction: { chat: string; until: number | null; reason: string } | null;
  reports: Report[];
  past: { id: number; outcome: string | null; closedAt: number }[];
};

export type Sanction = { id: string; handle: string; name: string; until: number | null; reason: string };

export type Change =
  | { do: "act"; case: number; action: "dismiss" | "warn" | "off-day" | "off-week" | "off-good" }
  | { do: "lift"; player: string }
  | { do: "ignore"; reporter: string; name: string; on: boolean };

export type ModerateFn = (change: Change) => Promise<{ ok: boolean; code?: string }>;

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-action-dark";
const quietButton = `rounded border border-line-strong px-3 py-1 font-semibold text-ink hover:bg-slate-100 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${focusRing}`;

const ACTIONS: { action: "dismiss" | "warn" | "off-day" | "off-week" | "off-good"; label: string }[] = [
  { action: "dismiss", label: "Dismiss" },
  { action: "warn", label: "Warn" },
  { action: "off-day", label: "Chat off 1 day" },
  { action: "off-week", label: "Chat off 7 days" },
  { action: "off-good", label: "Chat off for good" },
];

function when(at: number) {
  return new Date(at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function stateLine(c: Case) {
  if (c.state === "auto") return "Chat turned off for a day by three reports. Waiting for you.";
  if (c.state === "open") return "Open.";
  return `Closed: ${c.outcome ?? "done"}, ${c.closedAt ? when(c.closedAt) : ""}.`;
}

function Lines({ title, lines, marked }: { title: string; lines: Line[]; marked?: number | null }) {
  if (lines.length === 0) return null;
  return (
    <>
      <h4 className="font-semibold text-ink">{title}</h4>
      <ol className="list-decimal space-y-1 pl-6">
        {lines.map((line) => (
          <li key={line.seq}>
            {line.name}: {line.text}
            {line.seq === marked ? " (the line reported)" : ""}
          </li>
        ))}
      </ol>
    </>
  );
}

// One game's cases, then the players whose chat is off. `moderate` is
// passed in so tests need no Convex or Clerk.
export function GameModeration({
  game,
  cases,
  sanctions,
  moderate,
  reload,
}: {
  game: Game;
  cases: Case[];
  sanctions: Sanction[];
  moderate: ModerateFn;
  reload: () => void;
}) {
  const headingId = useId();
  const [status, setStatusText] = useState("");
  const [said, setSaid] = useState(0);
  const [busy, setBusy] = useState(false);
  const setStatus = useCallback((text: string) => {
    setStatusText(text);
    setSaid((count) => count + 1);
  }, []);

  async function run(change: Change, done: string) {
    if (busy) return;
    setBusy(true);
    setStatus("Saving…");
    try {
      const result = await moderate(change);
      if (result.ok) {
        setStatus(done);
        reload();
      } else if (result.code === "no_case") {
        setStatus("That case is already closed.");
        reload();
      } else if (result.code === "forbidden") {
        setStatus("This account can't moderate chat.");
      } else {
        setStatus("That didn't save. Try again in a moment.");
      }
    } catch {
      setStatus("That didn't save. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const open = cases.filter((c) => c.state !== "closed");
  const closed = cases.filter((c) => c.state === "closed");

  return (
    <section aria-labelledby={headingId} className="space-y-6">
      <h2 className="text-2xl font-bold text-ink" id={headingId}>
        {game.title}
      </h2>
      {/* Always mounted, so a change to its text is announced. */}
      <p aria-atomic="true" className="font-semibold text-ink" role="status">
        {status ? <span key={said}>{status}</span> : null}
      </p>
      {open.length === 0 ? <p className="text-slate-800">No open cases.</p> : null}
      {[...open, ...closed].map((c) => (
        <article className="max-w-3xl space-y-3 rounded border border-line bg-white p-5" key={c.id}>
          <h3 className="text-xl font-bold text-ink">
            {c.about.name}, {c.reports.length} {c.reports.length === 1 ? "report" : "reports"}
          </h3>
          <p>{stateLine(c)}</p>
          <p>
            Reported by{" "}
            {[...new Set(c.reports.map((r) => r.reporter.name + (r.counts ? "" : " (not counted)")))].join(", ")}. First
            report {when(c.openedAt)}.
          </p>
          {c.reports.map((r) => (
            <div className="space-y-2" key={r.id}>
              <p>
                {r.reporter.name}, {when(r.at)}
                {r.kind ? `, in ${r.kind}` : ", from the player list"}.{r.note ? ` Note: ${r.note}` : ""}
              </p>
              <Lines lines={r.context} marked={r.marked?.seq ?? null} title="Around the line reported" />
              <Lines lines={r.lines} title={`${c.about.name}'s last lines there`} />
              {c.state !== "closed" ? (
                <button
                  aria-disabled={busy || undefined}
                  className={quietButton}
                  onClick={() =>
                    void run(
                      { do: "ignore", reporter: r.reporter.id, name: r.reporter.name, on: !r.reporter.ignored },
                      r.reporter.ignored
                        ? `${r.reporter.name}'s reports count again.`
                        : `${r.reporter.name}'s reports no longer count.`,
                    )
                  }
                  type="button"
                >
                  {r.reporter.ignored ? `Count ${r.reporter.name}'s reports` : `Ignore ${r.reporter.name}'s reports`}
                </button>
              ) : null}
            </div>
          ))}
          {c.past.length > 0 ? (
            <p>
              Past cases: {c.past.map((p) => `${p.outcome ?? "closed"} (${when(p.closedAt)})`).join("; ")}.
            </p>
          ) : null}
          <p className="text-sm text-slate-600">Account: {c.about.id}</p>
          {c.state !== "closed" ? (
            <div className="flex flex-wrap gap-2">
              {ACTIONS.map(({ action, label }) => (
                <button
                  aria-disabled={busy || undefined}
                  aria-label={`${label}: ${c.about.name}`}
                  className={quietButton}
                  key={action}
                  onClick={() => void run({ do: "act", case: c.id, action }, `${c.about.name}: ${label.toLowerCase()}.`)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </article>
      ))}
      <h3 className="text-xl font-bold text-ink">Chat off</h3>
      {sanctions.length === 0 ? (
        <p className="text-slate-800">Nobody.</p>
      ) : (
        <ul className="space-y-2">
          {sanctions.map((s) => (
            <li className="flex flex-wrap items-center gap-4" key={s.id}>
              <span>
                {s.name}, {s.until ? `until ${when(s.until)}` : "for good"}
                {s.reason === "auto" ? ", by three reports" : ""}
              </span>
              <button
                aria-disabled={busy || undefined}
                className={quietButton}
                onClick={() => void run({ do: "lift", player: s.id }, `${s.name}'s chat is back on.`)}
                type="button"
              >
                Chat back on for {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Loaded = { cases: Case[]; sanctions: Sanction[] } | null | "failed";

function LiveGameModeration({ game, onDenied }: { game: Game; onDenied: () => void }) {
  const list = useAction(api.gamesModeration.adminChatCases);
  const change = useAction(api.gamesModeration.adminModerate);
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);
  const load = useCallback(() => {
    list({ game: game.id })
      .then((result) => {
        if (result === null) {
          setLoaded(null);
          onDenied();
        } else if (result.ok) {
          setLoaded(result.data as { cases: Case[]; sanctions: Sanction[] });
        } else {
          setLoaded("failed");
        }
      })
      .catch(() => setLoaded("failed"));
  }, [list, game.id, onDenied]);
  useEffect(load, [load]);
  const moderate = useCallback<ModerateFn>((c) => change({ game: game.id, change: c }), [change, game.id]);
  if (loaded === undefined) return <p role="status">Loading {game.title}…</p>;
  if (loaded === null) return null;
  if (loaded === "failed") return <p>{game.title}: the reports could not be loaded. Try again in a moment.</p>;
  return <GameModeration cases={loaded.cases} game={game} moderate={moderate} reload={load} sanctions={loaded.sanctions} />;
}

// The real wiring: a Clerk session, the owner check (in the Convex action), and the cases.
export function ModerationGate({ games }: { games: Game[] }) {
  const { isLoaded, isSignedIn } = useUser();
  const { isAuthenticated } = useConvexAuth();
  const [denied, setDenied] = useState(false);
  const onDenied = useCallback(() => setDenied(true), []);

  if (!isLoaded) return <p role="status">Loading your account…</p>;
  if (!isSignedIn) {
    return (
      <Section title="Sign in to continue">
        <AccountControls />
      </Section>
    );
  }
  if (!isAuthenticated) return <p role="status">Checking your account…</p>;
  if (denied) {
    return (
      <Section title="Not available">
        <p>Only the site&apos;s owner can read chat reports.</p>
      </Section>
    );
  }
  return (
    <div className="space-y-10">
      {games.map((game) => (
        <LiveGameModeration game={game} key={game.id} onDenied={onDenied} />
      ))}
    </div>
  );
}
