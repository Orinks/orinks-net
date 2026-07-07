"use client";

import Link from "next/link";
import { Show, SignInButton, SignUpButton, UserButton, useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAnnounce } from "./Announcer";
import { pickBark, producerLine, type Bark } from "../_lib/barks";
import { fetchManifest, HostAudioPlayer, initSpeech, speakProducer, stopProducer, type AudioManifest } from "../_lib/audio";
import { MusicEngine, MUSIC_TRACKS, STINGS } from "../_lib/music";
import { getPlayerKey, getStoredName, loadSettings, saveSettings, storeName, type GameSettings } from "../_lib/settings";

// --- Shared styles ---
const focusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";
const primaryButton = `inline-flex min-h-10 items-center justify-center rounded-md bg-amber-400 px-4 py-2 font-semibold text-zinc-950 hover:bg-amber-300 ${focusRing}`;
const secondaryButton = `inline-flex min-h-10 items-center justify-center rounded-md border border-amber-700 px-4 py-2 font-semibold text-amber-100 hover:bg-zinc-900 ${focusRing}`;

// --- Server payload shapes (mirrors convex/trivia.ts) ---
interface PublicQuestion {
  key: string;
  category: string;
  difficulty: number;
  prompt: string;
  choices: string[];
}
interface RunState {
  runId: Id<"triviaRuns">;
  status: string;
  isDaily: boolean;
  score: number;
  round: number;
  lives: number;
  streak: number;
  answeredInRound: number;
  questionsPerRound: number;
  questionNumber: number;
  roundCategory: string | null;
}
type GameEvent =
  | { type: "achievement"; key: string; name: string }
  | { type: "roundComplete"; round: number; nextCategory: string | null }
  | { type: "lifeGained"; lives: number }
  | { type: "tapeUnlocked"; id: string; title: string; order: number; total: number }
  | { type: "finaleReady" }
  | { type: "gameOver"; score: number; round: number; isPersonalBest: boolean }
  | { type: "bankExhausted" };
interface AnswerResult {
  correct: boolean;
  correctIndex: number;
  explanation: string | null;
  scoreDelta: number;
  events: GameEvent[];
  run: RunState;
  nextQuestion: PublicQuestion | null;
}
interface CaptionLine {
  seq: number;
  speaker: "Clide" | "Producer";
  text: string;
}
interface StoryLine {
  id: string;
  title?: string;
  text: string;
}

type Phase =
  | { kind: "title" }
  | { kind: "intro"; runNumber: number; isDaily: boolean }
  | { kind: "question" }
  | { kind: "feedback"; result: AnswerResult }
  | { kind: "tape"; tape: StoryLine; pending: GameEvent[]; result: AnswerResult }
  | { kind: "finale"; lines: StoryLine[]; pending: GameEvent[]; result: AnswerResult }
  | { kind: "gameover"; result: AnswerResult };

function categoryLabel(category: string | null | undefined): string {
  if (!category) return "Mixed bag";
  return category
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .replace("Rnb", "R&B");
}

export function GameApp() {
  const announce = useAnnounce();
  const { user, isSignedIn } = useUser();
  const accountHandle = user?.username ?? user?.fullName ?? user?.firstName ?? "your account";
  const ensurePlayer = useMutation(api.trivia.ensurePlayer);
  const startRunMutation = useMutation(api.trivia.startRun);
  const submitAnswerMutation = useMutation(api.trivia.submitAnswer);
  const abandonRunMutation = useMutation(api.trivia.abandonRun);
  const completeFinaleMutation = useMutation(api.trivia.completeFinale);

  const [playerKey, setPlayerKey] = useState("");
  const [name, setName] = useState("");
  const [settings, setSettings] = useState<GameSettings | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "title" });
  const [run, setRun] = useState<RunState | null>(null);
  const [question, setQuestion] = useState<PublicQuestion | null>(null);
  const [questionNumber, setQuestionNumber] = useState(1);
  const [chosenIndex, setChosenIndex] = useState<number | null>(null);
  const [captions, setCaptions] = useState<CaptionLine[]>([]);
  const [hostPaused, setHostPaused] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const manifestRef = useRef<AudioManifest>({ barks: {}, questions: {}, story: {} });
  const playerRef = useRef<HostAudioPlayer | null>(null);
  const musicRef = useRef<MusicEngine | null>(null);
  const [musicMuted, setMusicMuted] = useState(false);
  const captionSeq = useRef(0);

  const story = useQuery(api.trivia.getStory, playerKey ? { playerKey } : "skip");
  const resumable = useQuery(api.trivia.getActiveRun, playerKey ? { playerKey } : "skip");
  const epilogueBarks: Bark[] | null = story?.epilogueActive && story.epilogueLines ? story.epilogueLines : null;

  // Announce the identity change when the user signs in — the guest name field
  // is replaced by "Playing as X" elsewhere on screen, so a screen reader user
  // gets no confirmation of their new leaderboard name otherwise (a11y review).
  // Fires only on the sign-out → sign-in transition, never on initial load.
  const wasSignedIn = useRef(isSignedIn);
  useEffect(() => {
    if (isSignedIn === true && wasSignedIn.current === false) {
      announce(`Signed in. Playing as ${accountHandle}. This is your leaderboard name.`);
    }
    wasSignedIn.current = isSignedIn;
  }, [isSignedIn, accountHandle, announce]);

  // Client-only initialization.
  useEffect(() => {
    setPlayerKey(getPlayerKey());
    setName(getStoredName());
    const loaded = loadSettings();
    setSettings(loaded);
    playerRef.current = new HostAudioPlayer(loaded.hostVolume);
    musicRef.current = new MusicEngine({
      volume: loaded.musicVolume,
      muted: loaded.musicMuted,
      effectsEnabled: loaded.soundEffects,
    });
    setMusicMuted(loaded.musicMuted);
    fetchManifest().then((manifest) => {
      manifestRef.current = manifest;
    });
    return () => {
      playerRef.current?.stop();
      musicRef.current?.dispose();
    };
  }, []);

  const addCaption = useCallback((speaker: CaptionLine["speaker"], text: string) => {
    captionSeq.current += 1;
    const seq = captionSeq.current;
    setCaptions((prev) => [...prev.slice(-9), { seq, speaker, text }]);
  }, []);

  /** Plays a Clide clip with music ducked; the duck can never stick (safety timeout). */
  const playHostClip = useCallback(async (audioPath: string) => {
    const release = musicRef.current?.duck() ?? (() => {});
    try {
      await playerRef.current?.play(audioPath);
    } finally {
      release();
    }
  }, []);

  /** Replay ducks too — the user explicitly asked to re-hear the line. */
  const replayHostClip = useCallback(async () => {
    const release = musicRef.current?.duck() ?? (() => {});
    try {
      await playerRef.current?.replayLast();
    } finally {
      release();
    }
  }, []);

  /**
   * One voice per line (accessibility requirement): if a clip exists, play it
   * and keep the caption silent; if not, the caption text is announced so
   * screen reader users miss nothing. Returns the text for optional bundling.
   */
  const speakHostLine = useCallback(
    (text: string, audioPath: string | undefined, bundle: string[] | null): Promise<void> => {
      addCaption("Clide", text);
      if (audioPath && playerRef.current && !playerRef.current.paused) {
        return playHostClip(audioPath);
      }
      if (bundle) {
        bundle.push(`Clide: ${text}`);
      } else {
        announce(`Clide: ${text}`);
      }
      return Promise.resolve();
    },
    [addCaption, announce, playHostClip],
  );

  const playBark = useCallback(
    (trigger: string, bundle: string[] | null) => {
      const bark = pickBark(trigger, epilogueBarks);
      if (!bark) return;
      speakHostLine(bark.text, manifestRef.current.barks[bark.id] ?? manifestRef.current.story[bark.id], bundle);
    },
    [epilogueBarks, speakHostLine],
  );

  /** Producer output: device voice when enabled, otherwise the polite live region. */
  const producerSay = useCallback(
    (trigger: string, values: Record<string, string | number>, bundle: string[] | null) => {
      const text = producerLine(trigger, values, story?.epilogueActive ?? false);
      if (!text) return;
      addCaption("Producer", text);
      if (settings?.producerVoice) {
        // Duck music under the Producer; release on end/error/safety timeout.
        const release = musicRef.current?.duck() ?? (() => {});
        void speakProducer(text).then(release);
      } else if (bundle) {
        bundle.push(`Producer: ${text}`);
      } else {
        announce(`Producer: ${text}`);
      }
    },
    [addCaption, announce, settings?.producerVoice, story?.epilogueActive],
  );

  // --- Focus management: focus the heading of whatever just rendered.
  // Returning to title must also focus (never let focus die on unmount), but
  // initial page load must NOT steal focus — hence the flag.
  const questionHeadingRef = useRef<HTMLHeadingElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const titleHeadingRef = useRef<HTMLHeadingElement>(null);
  const returningToTitle = useRef(false);
  useEffect(() => {
    if (phase.kind === "question") {
      questionHeadingRef.current?.focus();
    } else if (phase.kind === "title") {
      if (returningToTitle.current) {
        returningToTitle.current = false;
        titleHeadingRef.current?.focus();
      }
    } else {
      panelHeadingRef.current?.focus();
    }
  }, [phase]);

  /** Question audio: play when auto-play is on; otherwise prime it so R/Replay serves it on demand. */
  const serveQuestionAudio = useCallback(
    (questionKey: string) => {
      const audioPath = manifestRef.current.questions[questionKey];
      if (!audioPath || !playerRef.current) return;
      if (settings?.autoPlayQuestionAudio && !playerRef.current.paused) {
        void playHostClip(audioPath);
      } else {
        playerRef.current.prime(audioPath);
      }
    },
    [playHostClip, settings?.autoPlayQuestionAudio],
  );

  // Phase → music mapping. Silent until ensureStarted() runs from a real
  // button activation; changes are ambient and deliberately unannounced —
  // music is never the sole carrier of game state (a11y review).
  useEffect(() => {
    const music = musicRef.current;
    if (!music?.started) return;
    if (phase.kind === "title" || phase.kind === "intro") {
      void music.playLoop(MUSIC_TRACKS.title);
    } else if (phase.kind === "question" || phase.kind === "feedback" || phase.kind === "tape") {
      void music.playLoop(MUSIC_TRACKS.bed);
    } else if (phase.kind === "finale") {
      void music.playOnce(MUSIC_TRACKS.finale);
    } else if (phase.kind === "gameover") {
      void music.playLoop(MUSIC_TRACKS.signoff); // loops while the player lingers
    }
  }, [phase.kind]);

  const toggleMusicMuted = useCallback(() => {
    setMusicMuted((prev) => {
      const next = !prev;
      musicRef.current?.setMuted(next);
      const current = loadSettings();
      saveSettings({ ...current, musicMuted: next });
      return next;
    });
  }, []);

  // --- Run flow ---

  const beginRun = useCallback(
    async (daily: boolean) => {
      if (!playerKey || busy) return;
      setBusy(true);
      setErrorText(null);
      announce("Starting the broadcast…");
      try {
        initSpeech(); // user gesture: unlock speechSynthesis
        musicRef.current?.ensureStarted(); // same gesture unlocks the AudioContext
        const trimmed = name.trim();
        await ensurePlayer({ playerKey, displayName: trimmed.length > 0 ? trimmed : undefined });
        if (trimmed.length > 0) storeName(trimmed);
        const started = await startRunMutation({ playerKey, daily });
        setRun(started.run as RunState);
        setQuestion(started.question);
        setQuestionNumber(1);
        setChosenIndex(null);
        // The show opens before the first question: title theme under Clide's
        // greeting, then the player advances at their own pace (no timers).
        setPhase({ kind: "intro", runNumber: started.runNumber, isDaily: daily });
        const bundle: string[] = [];
        if (daily) {
          playBark("daily-intro", bundle);
        } else {
          playBark(started.runNumber > 1 ? "run-intro-returning" : "run-intro", bundle);
        }
        producerSay("run-intro", { name: trimmed || "friend", runNumber: started.runNumber }, bundle);
        bundle.push(`Tonight's first theme: ${categoryLabel(started.run.roundCategory as string | null)}.`);
        bundle.forEach((line) => announce(line));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Something went wrong.";
        const friendly = message.includes("already aired")
          ? "Tonight's broadcast has already aired for you. Come back tomorrow!"
          : "The signal dropped. Please try again.";
        setErrorText(friendly);
        announce(friendly, "alert");
      } finally {
        setBusy(false);
      }
    },
    [announce, busy, ensurePlayer, name, playBark, playerKey, producerSay, startRunMutation],
  );

  const resumeRun = useCallback(() => {
    if (!resumable) return;
    initSpeech(); // user gesture: unlock speechSynthesis for the resumed run too
    musicRef.current?.ensureStarted();
    setRun(resumable.run as RunState);
    setQuestion(resumable.question);
    setQuestionNumber(resumable.run.questionNumber);
    setChosenIndex(null);
    // No show-open on resume: the player is mid-episode, get them back fast.
    setPhase({ kind: "question" });
    serveQuestionAudio(resumable.question.key);
  }, [resumable, serveQuestionAudio]);

  /** Leaves the on-air intro for the first question. */
  const beginQuestions = useCallback(() => {
    if (!question) return;
    setPhase({ kind: "question" });
    serveQuestionAudio(question.key);
  }, [question, serveQuestionAudio]);

  const chooseAnswer = useCallback(
    async (index: number) => {
      if (!run || !question || chosenIndex !== null || busy) return;
      setBusy(true);
      setChosenIndex(index);
      try {
        const result = (await submitAnswerMutation({
          playerKey,
          runId: run.runId,
          choiceIndex: index,
          clientHour: new Date().getHours(),
        })) as AnswerResult;
        setRun(result.run);

        const bundle: string[] = [];
        // Earcons fire immediately, at low gain, outside the ducking chain, and
        // never replace announcements (a11y review: reinforcement only).
        const music = musicRef.current;
        music?.playEffect(result.correct ? STINGS.correct : STINGS.wrong);
        if (result.run.lives === 1 && !result.correct && result.run.status === "active") {
          music?.playEffect(STINGS.lastLife);
        }
        for (const event of result.events) {
          if (event.type === "roundComplete") music?.playEffect(STINGS.round);
          else if (event.type === "lifeGained") music?.playEffect(STINGS.lifeGained);
          else if (event.type === "tapeUnlocked") music?.playEffect(STINGS.tapeFound);
          else if (event.type === "gameOver" && event.isPersonalBest) music?.playEffect(STINGS.highScore);
        }
        playBark(result.correct ? "correct" : "wrong", bundle);
        if (result.correct) {
          bundle.push(`Correct! Plus ${result.scoreDelta} points.`);
        } else {
          bundle.push(`Wrong. The correct answer was: ${question.choices[result.correctIndex]}.`);
        }
        if (result.explanation) bundle.push(result.explanation);
        bundle.push(
          `Score ${result.run.score}. ${result.run.lives} ${result.run.lives === 1 ? "life" : "lives"}.` +
            (result.run.streak >= 2 ? ` Streak ${result.run.streak}.` : ""),
        );
        if (result.run.lives === 1 && !result.correct && result.run.status === "active") {
          playBark("last-life", bundle);
        }
        if (result.run.streak > 0 && result.run.streak % 5 === 0) playBark("streak", bundle);
        for (const event of result.events) {
          if (event.type === "roundComplete") {
            playBark("round-transition", bundle);
            producerSay("round-transition", { round: event.round + 1 }, bundle);
            bundle.push(`Next round's theme: ${categoryLabel(event.nextCategory)}.`);
          } else if (event.type === "lifeGained") {
            bundle.push(`Life regained. ${event.lives} lives.`);
          } else if (event.type === "achievement") {
            producerSay("achievement", { achievementName: event.name }, bundle);
          } else if (event.type === "tapeUnlocked") {
            playBark("tape-found", bundle);
            producerSay("tape-found", { tapeNumber: event.order, tapeTotal: event.total }, bundle);
          } else if (event.type === "gameOver") {
            playBark(event.isPersonalBest ? "high-score" : "game-over", bundle);
            producerSay("game-over", { score: event.score, round: event.round }, bundle);
          }
        }
        bundle.forEach((line) => announce(line));
        setPhase({ kind: "feedback", result });
      } catch {
        setChosenIndex(null);
        announce("The signal dropped. Your answer didn't go through — try again.", "alert");
      } finally {
        setBusy(false);
      }
    },
    [announce, busy, chosenIndex, playBark, playerKey, producerSay, question, run, submitAnswerMutation],
  );

  const advanceAfterFeedback = useCallback(
    async (result: AnswerResult, pending: GameEvent[]) => {
      const [next, ...rest] = pending;
      if (next?.type === "tapeUnlocked") {
        const tape = story?.tapes.find((t) => t.id === next.id);
        if (tape) {
          const audioPath = manifestRef.current.story[tape.id];
          if (audioPath && playerRef.current && !playerRef.current.paused) void playHostClip(audioPath);
          setPhase({ kind: "tape", tape, pending: rest, result });
          return;
        }
        await advanceAfterFeedback(result, rest);
        return;
      }
      if (next?.type === "finaleReady") {
        try {
          const finale = await completeFinaleMutation({ playerKey });
          setPhase({ kind: "finale", lines: finale.lines, pending: rest, result });
          const first = finale.lines[0];
          const audioPath = manifestRef.current.story[first.id];
          if (audioPath && playerRef.current && !playerRef.current.paused) void playHostClip(audioPath);
          return;
        } catch {
          // Not eligible after all; fall through to the next event.
          await advanceAfterFeedback(result, rest);
          return;
        }
      }
      if (next?.type === "gameOver" || next?.type === "bankExhausted") {
        setPhase({ kind: "gameover", result });
        return;
      }
      if (next) {
        await advanceAfterFeedback(result, rest);
        return;
      }
      if (result.nextQuestion) {
        // Occasional flavor between questions: an archive fact or a lead-in.
        // Skipped after round transitions (Clide already spoke) and kept
        // infrequent so it stays charming at question three hundred.
        const hadRoundEvent = result.events.some((e) => e.type === "roundComplete");
        const roll = Math.random();
        const flavor = hadRoundEvent
          ? null
          : roll < 0.2
            ? pickBark("fact", epilogueBarks)
            : roll < 0.5
              ? pickBark("question-lead-in", epilogueBarks)
              : null;
        const flavorDone = flavor
          ? speakHostLine(flavor.text, manifestRef.current.barks[flavor.id], null)
          : Promise.resolve();
        const nextKey = result.nextQuestion.key;
        setQuestion(result.nextQuestion);
        setQuestionNumber(result.run.questionNumber);
        setChosenIndex(null);
        setPhase({ kind: "question" });
        void flavorDone.then(() => serveQuestionAudio(nextKey));
      } else {
        setPhase({ kind: "gameover", result });
      }
    },
    [completeFinaleMutation, epilogueBarks, playerKey, playHostClip, serveQuestionAudio, speakHostLine, story?.tapes],
  );

  const backToTitle = useCallback(() => {
    playerRef.current?.stop();
    stopProducer();
    setRun(null);
    setQuestion(null);
    returningToTitle.current = true; // focus the title heading, don't let focus die
    setPhase({ kind: "title" });
  }, []);

  const quitRun = useCallback(async () => {
    if (run && run.status === "active") {
      try {
        await abandonRunMutation({ playerKey });
      } catch {
        // Leaving anyway; the next startRun abandons it server-side.
      }
    }
    backToTitle();
  }, [abandonRunMutation, backToTitle, playerKey, run]);

  // --- Keyboard shortcuts (guarded; toggleable per WCAG 2.1.4) ---
  useEffect(() => {
    if (!settings?.numberShortcuts) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.key === "r" || event.key === "R") {
        void replayHostClip();
        return;
      }
      if (phase.kind === "question" && question && chosenIndex === null) {
        const num = Number.parseInt(event.key, 10);
        if (num >= 1 && num <= question.choices.length) {
          event.preventDefault();
          void chooseAnswer(num - 1);
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [chooseAnswer, chosenIndex, phase.kind, question, replayHostClip, settings?.numberShortcuts]);

  const toggleHostPaused = useCallback(() => {
    setHostPaused((prev) => {
      const next = !prev;
      playerRef.current?.setPaused(next);
      return next;
    });
  }, []);

  const statusItems = useMemo(
    () =>
      run
        ? [
            { label: "Score", value: String(run.score) },
            { label: "Round", value: String(run.round) },
            { label: "Lives", value: String(run.lives) },
            { label: "Streak", value: String(run.streak) },
          ]
        : [],
    [run],
  );

  if (!settings) {
    return <p className="py-8 text-center">Tuning the signal…</p>;
  }

  // --- Title screen ---
  if (phase.kind === "title") {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-bold text-amber-200" ref={titleHeadingRef} tabIndex={-1}>
          The Midnight Signal
        </h1>
        <p className="mt-3 leading-7 text-amber-50">
          A late-night music quiz show that has been broadcasting since 1963 and never officially
          ended. Answer trivia, survive the rounds, and recover the master tapes. Fully playable
          with a screen reader — the host speaks, and everything he says is also text.
        </p>
        <form
          className="mt-6"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void beginRun(false);
          }}
        >
          <Show when="signed-out">
            <label className="block font-semibold text-amber-100" htmlFor="contestant-name">
              Contestant name
            </label>
            <input
              autoComplete="nickname"
              className={`mt-1 w-full max-w-xs rounded-md border border-amber-700 bg-zinc-900 px-3 py-2 text-amber-50 ${focusRing}`}
              id="contestant-name"
              maxLength={24}
              onChange={(event) => setName(event.target.value)}
              type="text"
              value={name}
            />
          </Show>
          <Show when="signed-in">
            <p className="font-semibold text-amber-100">Playing as {accountHandle}</p>
            <p className="mt-1 text-sm leading-6 text-zinc-400">
              Your account name is what appears on the leaderboards. To change it, use the account
              button in the Account section below.
            </p>
          </Show>
          <div className="mt-4 flex flex-wrap gap-3">
            <button aria-disabled={busy} className={primaryButton} type="submit">
              Start broadcast
            </button>
            <button aria-disabled={busy} className={secondaryButton} onClick={() => void beginRun(true)} type="button">
              Tonight&apos;s broadcast (daily)
            </button>
            {resumable ? (
              <button className={secondaryButton} onClick={resumeRun} type="button">
                Resume broadcast
              </button>
            ) : null}
            <button className={secondaryButton} onClick={toggleMusicMuted} type="button">
              {musicMuted ? "Unmute music" : "Mute music"}
            </button>
          </div>
        </form>
        {errorText ? <p className="mt-4 font-semibold text-amber-300">{errorText}</p> : null}
        <section aria-labelledby="account-heading" className="mt-8">
          <h2 className="text-lg font-semibold text-amber-100" id="account-heading">
            Account
          </h2>
          <Show when="signed-out">
            <p className="mt-1 text-sm leading-6 text-zinc-400">
              Sign in to save your progress and appear on the leaderboards across all the games.
              It&apos;s optional — you can keep playing as a guest.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <SignInButton mode="modal">
                <button className={primaryButton} type="button">
                  Sign in
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className={secondaryButton} type="button">
                  Create account
                </button>
              </SignUpButton>
            </div>
          </Show>
          <Show when="signed-in">
            <div className="mt-2 flex items-center gap-3">
              <span className="text-sm text-zinc-400">You&apos;re signed in.</span>
              <UserButton />
            </div>
          </Show>
        </section>
        <nav aria-label="Game sections" className="mt-8">
          <ul className="flex flex-wrap gap-3">
            <li>
              <Link className={secondaryButton} href="/midnight-signal/archive">
                Tape archive
              </Link>
            </li>
            <li>
              <Link className={secondaryButton} href="/midnight-signal/leaderboard">
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
          The Producer (the show&apos;s second voice) can speak through your device&apos;s speech
          synthesis. It&apos;s off by default — screen reader users usually prefer announcements
          through their own screen reader. Keyboard shortcuts: 1 to 4 answer questions, R replays
          Clide&apos;s last line. Both can be changed in Settings. Questions include material from{" "}
          <a className={`underline ${focusRing}`} href="https://opentdb.com">
            Open Trivia Database
          </a>{" "}
          (CC BY-SA 4.0).
        </p>
      </div>
    );
  }

  // --- In-game screens share the status bar, global audio controls, caption log ---
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-amber-200">The Midnight Signal</h1>
      {run ? (
        <dl aria-label="Run status" className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-b border-amber-700 pb-3">
          {statusItems.map((item) => (
            <div className="flex gap-2" key={item.label}>
              <dt className="font-semibold text-amber-100">{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {phase.kind === "intro" ? (
        <section aria-labelledby="intro-heading" className="mt-6">
          <h2 className="text-xl font-semibold text-amber-200" id="intro-heading" ref={panelHeadingRef} tabIndex={-1}>
            {phase.isDaily
              ? "Tonight's broadcast — on the air"
              : `On the air — Episode ${phase.runNumber}`}
          </h2>
          <p className="mt-2 leading-7">
            The studio lights are up, Clide is at the desk, and the signal is warm. Tonight&apos;s
            first theme: {categoryLabel(run?.roundCategory)}. The first question comes when
            you&apos;re ready.
          </p>
          <button className={`${primaryButton} mt-4`} onClick={beginQuestions} type="button">
            Begin the questions
          </button>
        </section>
      ) : null}

      {(phase.kind === "question" || phase.kind === "feedback") && question ? (
        <section aria-labelledby="question-heading" className="mt-6">
          <p className="text-sm text-zinc-400">
            Question {questionNumber} · Round {run?.round} · Theme: {categoryLabel(run?.roundCategory)}
          </p>
          <h2 className="mt-2 text-xl font-semibold" id="question-heading" ref={questionHeadingRef} tabIndex={-1}>
            {question.prompt}
          </h2>
          <div aria-labelledby="question-heading" className="mt-4 grid gap-3" role="group">
            {question.choices.map((choice, index) => (
              <button
                aria-disabled={chosenIndex !== null}
                aria-keyshortcuts={settings.numberShortcuts ? String(index + 1) : undefined}
                className={`${secondaryButton} justify-start text-left`}
                key={choice}
                onClick={() => void chooseAnswer(index)}
                type="button"
              >
                {index + 1}. {choice}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {phase.kind === "feedback" ? (
        <section aria-labelledby="feedback-heading" className="mt-6">
          <h2
            className={`text-xl font-semibold ${phase.result.correct ? "text-amber-200" : "text-amber-300"}`}
            id="feedback-heading"
            ref={panelHeadingRef}
            tabIndex={-1}
          >
            {phase.result.correct ? "Correct!" : "Wrong."}
          </h2>
          {question ? (
            <p className="mt-2 leading-7">
              {phase.result.correct
                ? `You picked the right answer: ${question.choices[phase.result.correctIndex]}.`
                : `Your answer: ${chosenIndex !== null ? question.choices[chosenIndex] : "none"}. Correct answer: ${question.choices[phase.result.correctIndex]}.`}
              {phase.result.correct ? ` Plus ${phase.result.scoreDelta} points.` : ""}
            </p>
          ) : null}
          {phase.result.explanation ? <p className="mt-2 leading-7 text-zinc-400">{phase.result.explanation}</p> : null}
          <button
            className={`${primaryButton} mt-4`}
            onClick={() => void advanceAfterFeedback(phase.result, phase.result.events)}
            type="button"
          >
            {phase.result.events.some((e) => e.type === "gameOver" || e.type === "bankExhausted")
              ? "Continue"
              : "Next question"}
          </button>
        </section>
      ) : null}

      {phase.kind === "tape" ? (
        <section aria-labelledby="tape-heading" className="mt-6">
          <h2 className="text-xl font-semibold text-amber-200" id="tape-heading" ref={panelHeadingRef} tabIndex={-1}>
            Master tape recovered: {phase.tape.title}
          </h2>
          <p className="mt-3 leading-7">{phase.tape.text}</p>
          <button
            className={`${primaryButton} mt-4`}
            onClick={() => void advanceAfterFeedback(phase.result, phase.pending)}
            type="button"
          >
            Continue
          </button>
        </section>
      ) : null}

      {phase.kind === "finale" ? (
        <section aria-labelledby="finale-heading" className="mt-6">
          <h2 className="text-xl font-semibold text-amber-200" id="finale-heading" ref={panelHeadingRef} tabIndex={-1}>
            Channel 100
          </h2>
          {phase.lines.map((line) => (
            <div className="mt-4" key={line.id}>
              {line.title ? <h3 className="font-semibold text-amber-100">{line.title}</h3> : null}
              <p className="mt-1 leading-7">{line.text}</p>
            </div>
          ))}
          <button
            className={`${primaryButton} mt-6`}
            onClick={() => void advanceAfterFeedback(phase.result, phase.pending)}
            type="button"
          >
            Continue
          </button>
        </section>
      ) : null}

      {phase.kind === "gameover" ? (
        <section aria-labelledby="gameover-heading" className="mt-6">
          <h2 className="text-xl font-semibold text-amber-200" id="gameover-heading" ref={panelHeadingRef} tabIndex={-1}>
            Broadcast over
          </h2>
          <p className="mt-2 leading-7">
            Final score {phase.result.run.score}, round {phase.result.run.round}.
            {phase.result.events.some((e) => e.type === "gameOver" && e.isPersonalBest)
              ? " That's a new personal best!"
              : ""}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button className={primaryButton} onClick={() => void beginRun(false)} type="button">
              Start new broadcast
            </button>
            <Link className={secondaryButton} href="/midnight-signal/leaderboard">
              View leaderboard
            </Link>
            <button className={secondaryButton} onClick={backToTitle} type="button">
              Back to title
            </button>
          </div>
        </section>
      ) : null}

      <div className="mt-8 flex flex-wrap gap-3 border-t border-amber-700 pt-4">
        <button className={secondaryButton} onClick={() => void replayHostClip()} type="button">
          Replay Clide&apos;s last line
        </button>
        <button className={secondaryButton} onClick={toggleHostPaused} type="button">
          {hostPaused ? "Resume host audio" : "Pause host audio"}
        </button>
        <button className={secondaryButton} onClick={toggleMusicMuted} type="button">
          {musicMuted ? "Unmute music" : "Mute music"}
        </button>
        {phase.kind === "intro" || phase.kind === "question" || phase.kind === "feedback" ? (
          <button className={secondaryButton} onClick={() => void quitRun()} type="button">
            Quit run
          </button>
        ) : null}
      </div>

      {settings.captions && captions.length > 0 ? (
        <section aria-labelledby="captions-heading" className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400" id="captions-heading">
            Captions
          </h2>
          <ul className="mt-2 space-y-1 text-sm leading-6 text-zinc-400">
            {captions.map((line) => (
              <li key={line.seq}>
                <span className="font-semibold text-amber-100">{line.speaker}:</span> {line.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
