"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { getPlayerKey } from "../_lib/settings";

const focusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";
const buttonStyle = `inline-flex min-h-10 items-center justify-center rounded-md border border-amber-700 px-4 py-2 font-semibold text-amber-100 hover:bg-zinc-900 ${focusRing}`;

export function Profile() {
  const [playerKey, setPlayerKey] = useState("");
  useEffect(() => setPlayerKey(getPlayerKey()), []);
  const profile = useQuery(api.trivia.getProfile, playerKey ? { playerKey } : "skip");

  if (profile === undefined) {
    return <p>Pulling your file from the archive…</p>;
  }
  if (profile === null) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-bold text-amber-200">Profile</h1>
        <p className="mt-3 leading-7">
          No contestant file yet — the show hasn&apos;t met you. Start your first broadcast and
          come back.
        </p>
        <p className="mt-6">
          <Link className={buttonStyle} href="/midnight-signal">
            Back to The Midnight Signal
          </Link>
        </p>
      </div>
    );
  }

  const accuracy =
    profile.totalAnswered > 0 ? Math.round((profile.totalCorrect / profile.totalAnswered) * 100) : 0;
  const stats = [
    { label: "Best score", value: String(profile.bestScore) },
    { label: "Deepest round", value: String(profile.deepestRound) },
    { label: "Broadcasts", value: String(profile.totalRuns) },
    { label: "Questions answered", value: String(profile.totalAnswered) },
    { label: "Accuracy", value: `${accuracy}%` },
    { label: "Master tapes", value: `${profile.tapesUnlocked} of ${profile.tapesTotal}` },
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-bold text-amber-200">
        {profile.displayName}
        {profile.epilogueActive ? " — Keeper of the Signal" : ""}
      </h1>
      <section aria-labelledby="stats-heading" className="mt-6">
        <h2 className="text-xl font-semibold text-amber-100" id="stats-heading">
          Statistics
        </h2>
        <dl className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {stats.map((stat) => (
            <div className="flex justify-between gap-4 border-b border-zinc-700 py-1" key={stat.label}>
              <dt className="font-semibold text-amber-100">{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="achievements-heading" className="mt-8">
        <h2 className="text-xl font-semibold text-amber-100" id="achievements-heading">
          Achievements
        </h2>
        <ul className="mt-3 space-y-3">
          {profile.achievements.map((achievement) => {
            const locked = achievement.unlockedAt === null;
            const hidden = locked && achievement.secret;
            return (
              <li className="rounded-lg border border-zinc-700 p-3" key={achievement.key}>
                <h3 className={`font-semibold ${locked ? "text-zinc-400" : "text-amber-100"}`}>
                  {hidden ? (
                    <>
                      <span aria-hidden="true">???</span>
                      <span className="sr-only">Secret achievement</span>
                    </>
                  ) : (
                    achievement.name
                  )}
                  <span className="ml-2 text-sm font-normal text-zinc-400">
                    {locked ? "(locked)" : "(unlocked)"}
                  </span>
                </h3>
                {!hidden ? <p className="mt-1 text-sm leading-6 text-zinc-400">{achievement.description}</p> : null}
              </li>
            );
          })}
        </ul>
      </section>
      <p className="mt-8">
        <Link className={buttonStyle} href="/midnight-signal">
          Back to The Midnight Signal
        </Link>
      </p>
    </div>
  );
}
