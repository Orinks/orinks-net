"use client";

import Link from "next/link";
import { Show } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import type { FormEvent, RefObject } from "react";
import { AccountControls } from "@/components/AccountControls";
import { focusRing, primaryButton, secondaryButton } from "./gameTypes";

interface TitleScreenProps {
  titleHeadingRef: RefObject<HTMLHeadingElement | null>;
  name: string;
  setName: (name: string) => void;
  busy: boolean;
  beginRun: (daily: boolean) => Promise<void>;
  canResume: boolean;
  resumeRun: () => void;
  musicMuted: boolean;
  toggleMusicMuted: () => void;
  errorText: string | null;
  accountHandle: string;
}

export function TitleScreen(props: TitleScreenProps) {
  return (
    <div className="mx-auto max-w-2xl">
      <h1
        className="text-3xl font-bold text-amber-200"
        ref={props.titleHeadingRef}
        tabIndex={-1}
      >
        The Midnight Signal
      </h1>
      <p className="mt-3 leading-7 text-amber-50">
        A late-night music quiz show that has been broadcasting since 1963 and
        never officially ended. Answer trivia, survive the rounds, and recover
        the master tapes. Fully playable with a screen reader — the host speaks,
        and everything he says is also text.
      </p>
      <form
        className="mt-6"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void props.beginRun(false);
        }}
      >
        <Show when="signed-out">
          <label
            className="block font-semibold text-amber-100"
            htmlFor="contestant-name"
          >
            Contestant name
          </label>
          <input
            autoComplete="nickname"
            className={`mt-1 w-full max-w-xs rounded-md border border-amber-700 bg-zinc-900 px-3 py-2 text-amber-50 ${focusRing}`}
            id="contestant-name"
            maxLength={24}
            onChange={(event) => props.setName(event.target.value)}
            type="text"
            value={props.name}
          />
        </Show>
        <Show when="signed-in">
          <p className="font-semibold text-amber-100">
            Playing as {props.accountHandle}
          </p>
          <p className="mt-1 text-sm leading-6 text-zinc-400">
            Your account name is what appears on the leaderboards. To change it,
            use the account button in the Account section below.
          </p>
        </Show>
        <div className="mt-4 flex flex-wrap gap-3">
          <button className={primaryButton} disabled={props.busy} type="submit">
            Start broadcast
          </button>
          <button
            className={secondaryButton}
            disabled={props.busy}
            onClick={() => void props.beginRun(true)}
            type="button"
          >
            Tonight&apos;s broadcast (daily)
          </button>
          {props.canResume ? (
            <button
              className={secondaryButton}
              onClick={props.resumeRun}
              type="button"
            >
              Resume broadcast
            </button>
          ) : null}
          <button
            className={secondaryButton}
            onClick={props.toggleMusicMuted}
            type="button"
          >
            {props.musicMuted ? "Unmute music" : "Mute music"}
          </button>
        </div>
      </form>
      {props.errorText ? (
        <p className="mt-4 font-semibold text-amber-300">{props.errorText}</p>
      ) : null}
      <section aria-labelledby="account-heading" className="mt-8">
        <h2
          className="text-lg font-semibold text-amber-100"
          id="account-heading"
        >
          Account
        </h2>
        <Show when="signed-out">
          <p className="mt-1 text-sm leading-6 text-zinc-400">
            Sign in to save your progress and appear on the leaderboards across
            all the games. It&apos;s optional — you can keep playing as a guest.
          </p>
        </Show>
        <div className="mt-3">
          <AccountControls
            nameClassName="text-sm font-semibold text-amber-100"
            signInClassName={primaryButton}
            signUpClassName={secondaryButton}
            userButtonAppearance={{
              theme: dark,
              variables: {
                colorBackground: "#18181b",
                colorPrimary: "#f59e0b",
                colorPrimaryForeground: "#1c1917",
                colorDanger: "#f87171",
              },
            }}
          />
        </div>
      </section>
      <nav aria-label="Game sections" className="mt-8">
        <ul className="flex flex-wrap gap-3">
          <li>
            <Link className={secondaryButton} href="/midnight-signal/archive">
              Tape archive
            </Link>
          </li>
          <li>
            <Link
              className={secondaryButton}
              href="/midnight-signal/leaderboard"
            >
              Leaderboard
            </Link>
          </li>
          <li>
            <Link className={secondaryButton} href="/midnight-signal/profile">
              Profile
            </Link>
          </li>
          <li>
            <Link className={secondaryButton} href="/midnight-signal/settings">
              Settings
            </Link>
          </li>
        </ul>
      </nav>
      <p className="mt-6 text-sm leading-6 text-zinc-400">
        Short station transmissions connect the archive, chart desk, studio,
        listener wire, and new music streams to Clyde&apos;s world. Their full
        text is always visible, they never change scoring or question order, and
        nightly transmissions are shared by every contestant.
      </p>
      <p className="mt-3 text-sm leading-6 text-zinc-400">
        Keyboard shortcuts: 1 to 4 answer questions and pick Signal Boosts; R
        replays Clyde&apos;s last line. Settings controls narration, device
        speech, captions, and music. Existing banks retain{" "}
        <a className={`underline ${focusRing}`} href="https://opentdb.com">
          Open Trivia Database
        </a>{" "}
        (CC BY-SA 4.0) and{" "}
        <a
          className={`underline ${focusRing}`}
          href="https://musicbrainz.org/doc/About/Data_License"
        >
          MusicBrainz data-license
        </a>{" "}
        credits; new official questions show their exact source after each
        answer.
      </p>
    </div>
  );
}
