"use client";

import { useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AccountControls } from "@/components/AccountControls";
import { Section } from "@/components/Section";
import { api } from "@/convex/_generated/api";

type Game = { id: string; title: string };

type SetResult =
  | { ok: true; name: string; game: string; tester: boolean }
  | { ok: false; code: "no_player" | "forbidden" };

export type SetTesterFn = (input: { name: string; game: string; tester: boolean }) => Promise<SetResult>;

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-action-dark";
const button = `rounded bg-action px-4 py-2 font-semibold text-white hover:bg-action-dark aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${focusRing}`;
const quietButton = `rounded border border-line-strong px-3 py-1 font-semibold text-ink hover:bg-slate-100 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${focusRing}`;

// One game's testers: the list, a Remove button on each, and a name field
// to add one. `setTester` is passed in so tests need no Convex or Clerk.
// Follows the connect page: an always-mounted status line, and focus that
// lands somewhere sensible after every change.
export function GameTesters({
  game,
  testers,
  setTester,
}: {
  game: Game;
  testers: string[];
  setTester: SetTesterFn;
}) {
  const nameId = useId();
  const hintId = useId();
  const statusId = useId();
  const headingId = useId();
  const [name, setName] = useState("");
  const [status, setStatusText] = useState("");
  // Bumped with every message, so the same words twice are read twice.
  const [said, setSaid] = useState(0);
  const setStatus = useCallback((text: string) => {
    setStatusText(text);
    setSaid((count) => count + 1);
  }, []);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // After a removal, once the list no longer holds the player, focus goes to
  // the row that took its place, or the field; then the result is said, a
  // moment later so the focus move does not cut it off.
  const [removed, setRemoved] = useState<{ name: string; index: number } | null>(null);

  useEffect(() => {
    if (!removed || testers.includes(removed.name)) return;
    const buttons = listRef.current?.querySelectorAll("button");
    const next = buttons?.length ? buttons[Math.min(removed.index, buttons.length - 1)] : null;
    (next ?? nameRef.current)?.focus();
    const done = removed.name;
    setRemoved(null);
    setTimeout(() => setStatus(`${done} removed.`), 100);
  }, [removed, testers, setStatus]);

  async function change(player: string, tester: boolean, index = 0) {
    if (busy) return;
    setBusy(true);
    setInvalid(false);
    setStatus(tester ? "Adding…" : "Removing…");
    try {
      const result = await setTester({ name: player, game: game.id, tester });
      if (result.ok) {
        if (tester) {
          setStatus(`${result.name} added.`);
          setName("");
        } else {
          setRemoved({ name: result.name, index });
        }
      } else if (result.code === "no_player") {
        setStatus(`Nobody is called ${player}. They need to connect ${game.title} once first.`);
        if (tester) {
          setInvalid(true);
          nameRef.current?.focus();
        }
      } else {
        setStatus("This account can't change testers.");
      }
    } catch {
      setStatus("That didn't save. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const player = name.trim();
    if (!player) {
      setStatus("Type a player name.");
      setInvalid(true);
      nameRef.current?.focus();
      return;
    }
    void change(player, true);
  }

  return (
    <section aria-labelledby={headingId} className="max-w-xl space-y-5 rounded border border-line bg-white p-5">
      <h2 className="text-2xl font-bold text-ink" id={headingId}>
        {game.title}
      </h2>
      {testers.length === 0 ? (
        <p className="text-slate-800">No testers.</p>
      ) : (
        <ul className="space-y-2" ref={listRef}>
          {testers.map((player, index) => (
            <li className="flex items-center justify-between gap-4" key={player}>
              <span className="text-ink">{player}</span>
              <button
                aria-disabled={busy || undefined}
                className={quietButton}
                onClick={() => void change(player, false, index)}
                type="button"
              >
                Remove {player}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="space-y-2" noValidate onSubmit={onSubmit}>
        <label className="block font-semibold text-ink" htmlFor={nameId}>
          Player name
        </label>
        <input
          aria-describedby={invalid ? `${statusId} ${hintId}` : hintId}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          className="w-full rounded border border-line-strong px-3 py-2 text-ink"
          id={nameId}
          maxLength={48}
          onChange={(event) => {
            setName(event.target.value);
            if (invalid) setInvalid(false);
          }}
          ref={nameRef}
          type="text"
          value={name}
        />
        <p className="text-sm text-slate-600" id={hintId}>
          The name the game shows under Settings, Online account.
        </p>
        <button aria-disabled={busy || undefined} className={button} type="submit">
          {busy ? "Saving…" : "Add tester"}
        </button>
      </form>
      {/* Always mounted, so a change to its text is announced. */}
      <p aria-atomic="true" className="font-semibold text-ink" id={statusId} role="status">
        {status ? <span key={said}>{status}</span> : null}
      </p>
    </section>
  );
}

function LiveGameTesters({ game, setTester }: { game: Game; setTester: SetTesterFn }) {
  const testers = useQuery(api.games.adminListTesters, { game: game.id });
  if (testers === undefined) return <p>Loading {game.title}…</p>;
  if (testers === null) return null;
  return <GameTesters game={game} setTester={setTester} testers={testers} />;
}

// The real wiring: a Clerk session, the owner check, and the mutation.
export function TestersGate({ games }: { games: Game[] }) {
  const { isLoaded, isSignedIn } = useUser();
  const { isAuthenticated } = useConvexAuth();
  // Asked once for the first game, to learn whether this account may see the page.
  const first = games[0]?.id ?? "wickets";
  const allowed = useQuery(api.games.adminListTesters, isAuthenticated ? { game: first } : "skip");
  const setTesterMutation = useMutation(api.games.adminSetTester);
  const setTester = useCallback<SetTesterFn>(
    (input) => setTesterMutation(input) as Promise<SetResult>,
    [setTesterMutation],
  );

  if (!isLoaded) return <p role="status">Loading your account…</p>;
  if (!isSignedIn) {
    return (
      <Section title="Sign in to continue">
        <AccountControls />
      </Section>
    );
  }
  if (!isAuthenticated || allowed === undefined) return <p role="status">Checking your account…</p>;
  if (allowed === null) {
    return (
      <Section title="Not available">
        <p>Only the site&apos;s owner can change testers.</p>
      </Section>
    );
  }
  return (
    <div className="space-y-8">
      {games.map((game) => (
        <LiveGameTesters game={game} key={game.id} setTester={setTester} />
      ))}
    </div>
  );
}
