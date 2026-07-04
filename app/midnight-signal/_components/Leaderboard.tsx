"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useAnnounce } from "./Announcer";
import { getPlayerKey } from "../_lib/settings";

type Scope = "alltime" | "daily" | "weekly";

const focusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";
const buttonStyle = `inline-flex min-h-10 items-center justify-center rounded-md border border-amber-700 px-4 py-2 font-semibold text-amber-100 hover:bg-zinc-900 ${focusRing}`;
const activeButtonStyle = `inline-flex min-h-10 items-center justify-center rounded-md bg-amber-400 px-4 py-2 font-semibold text-zinc-950 ${focusRing}`;

const scopeLabels: Record<Scope, string> = {
  alltime: "All time",
  daily: "Tonight's broadcast",
  weekly: "This week",
};

export function Leaderboard() {
  const announce = useAnnounce();
  const [scope, setScope] = useState<Scope>("alltime");
  const [playerKey, setPlayerKey] = useState("");
  useEffect(() => setPlayerKey(getPlayerKey()), []);
  const rows = useQuery(api.trivia.getLeaderboard, {
    scope,
    limit: 20,
    playerKey: playerKey || undefined,
  });

  const selectScope = (next: Scope) => {
    setScope(next);
  };

  // Announce when the data actually arrives, not when the button is pressed —
  // otherwise the result count lands silently after "Reading the scores…".
  const announcedFor = useRef<string | null>(null);
  useEffect(() => {
    if (rows === undefined) return;
    if (announcedFor.current === scope) return;
    const skipFirstLoad = announcedFor.current === null;
    announcedFor.current = scope;
    if (skipFirstLoad) return; // page load: content is read normally, no announcement needed
    announce(
      `${scopeLabels[scope]} leaderboard: ${rows.length === 0 ? "no entries yet" : `${rows.length} ${rows.length === 1 ? "entry" : "entries"}`}.`,
    );
  }, [announce, rows, scope]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-bold text-amber-200">Leaderboard</h1>
      <div className="mt-4 flex flex-wrap gap-3">
        {(Object.keys(scopeLabels) as Scope[]).map((key) => (
          <button
            aria-pressed={scope === key}
            className={scope === key ? activeButtonStyle : buttonStyle}
            key={key}
            onClick={() => selectScope(key)}
            type="button"
          >
            {scopeLabels[key]}
          </button>
        ))}
      </div>
      {rows === undefined ? (
        <p className="mt-6">Reading the scores…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6">
          No broadcasts on record yet for this period. The signal waits for its first contestant.
        </p>
      ) : (
        <table className="mt-6 w-full border-collapse text-left">
          <caption className="sr-only">{scopeLabels[scope]} leaderboard, ranked by score</caption>
          <thead>
            <tr className="border-b border-amber-700">
              <th className="py-2 pr-4 font-semibold text-amber-100" scope="col">
                Rank
              </th>
              <th className="py-2 pr-4 font-semibold text-amber-100" scope="col">
                Contestant
              </th>
              <th className="py-2 pr-4 font-semibold text-amber-100" scope="col">
                Score
              </th>
              <th className="py-2 font-semibold text-amber-100" scope="col">
                Round
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="border-b border-zinc-700" key={`${row.rank}-${row.endedAt}`}>
                <th className="py-2 pr-4 font-normal" scope="row">
                  {row.rank}
                </th>
                <td className="py-2 pr-4">
                  {row.displayName}
                  {row.isYou ? " (you)" : ""}
                </td>
                <td className="py-2 pr-4">{row.score}</td>
                <td className="py-2">{row.round}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-8">
        <Link className={buttonStyle} href="/midnight-signal">
          Back to The Midnight Signal
        </Link>
      </p>
    </div>
  );
}
