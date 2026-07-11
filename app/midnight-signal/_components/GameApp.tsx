"use client";

import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { userDisplayName } from "@/lib/user-name";
import { useAnnounce } from "./Announcer";
import { TitleScreen } from "./TitleScreen";
import { InGameView } from "./InGameView";
import { useGameShortcuts } from "./useGameShortcuts";
import { useDailyResultCopy } from "./useDailyResultCopy";
import {
  BOSS_REWARDS,
  buildStatusItems,
  categoryLabel,
  dailyShareText,
  type AnswerResult,
  type BoostState,
  type CaptionLine,
  type GameEvent,
  type Phase,
  type PublicQuestion,
  type RunState,
  type StoryLine,
} from "./gameTypes";
import { pickBark, producerLine, type Bark } from "../_lib/barks";
import {
  fetchManifest,
  HostAudioPlayer,
  initSpeech,
  speakProducer,
  stopProducer,
  type AudioManifest,
} from "../_lib/audio";
import { MusicEngine, MUSIC_TRACKS, STINGS } from "../_lib/music";
import {
  applyMotionPreference,
  getPlayerKey,
  getStoredName,
  loadSettings,
  saveSettings,
  storeName,
  type GameSettings,
} from "../_lib/settings";

export function GameApp() {
  const announce = useAnnounce();
  const { user, isSignedIn } = useUser();
  const accountHandle = userDisplayName(user, "your account");
  const ensurePlayer = useMutation(api.trivia.ensurePlayer);
  const startRunMutation = useMutation(api.trivia.startRun);
  const submitAnswerMutation = useMutation(api.trivia.submitAnswer);
  const chooseBoostMutation = useMutation(api.trivia.chooseBoost);
  const activateBoostMutation = useMutation(api.trivia.useBoost);
  const answerBossCallMutation = useMutation(api.trivia.answerBossCall);
  const chooseBossRewardMutation = useMutation(api.trivia.chooseBossReward);
  const whisperMutation = useMutation(api.trivia.useSignal);
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
  const [boosts, setBoosts] = useState<BoostState | null>(null);
  const [draftChosen, setDraftChosen] = useState<string | null>(null); // double-activation guard, mirrors chosenIndex
  const [rewardChosen, setRewardChosen] = useState<string | null>(null); // same guard for the boss reward screen
  // Two choice screens can stack (reward → draft); a brief hold keeps a
  // number key pressed for one from landing on the other (a11y consult).
  const shortcutHoldUntil = useRef(0);
  const { copyDailyResult, copyFallback, copyFallbackRef, resetCopyFallback } =
    useDailyResultCopy(announce);
  const [captions, setCaptions] = useState<CaptionLine[]>([]);
  const [hostPaused, setHostPaused] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const manifestRef = useRef<AudioManifest>({
    barks: {},
    questions: {},
    story: {},
  });
  const playerRef = useRef<HostAudioPlayer | null>(null);
  const musicRef = useRef<MusicEngine | null>(null);
  const stopMysteryClipRef = useRef<(() => void) | null>(null);
  const [musicMuted, setMusicMuted] = useState(false);
  const captionSeq = useRef(0);

  const registerMysteryClipStop = useCallback((stop: (() => void) | null) => {
    stopMysteryClipRef.current = stop;
  }, []);

  const stopMysteryClip = useCallback(() => {
    stopMysteryClipRef.current?.();
  }, []);

  const prepareMysteryClip = useCallback(() => {
    playerRef.current?.stop();
    stopProducer();
  }, []);

  const suppressMusicForClip = useCallback(
    () => musicRef.current?.suppress() ?? (() => {}),
    [],
  );

  const story = useQuery(
    api.trivia.getStory,
    playerKey ? { playerKey } : "skip",
  );
  const resumable = useQuery(
    api.trivia.getActiveRun,
    playerKey ? { playerKey } : "skip",
  );
  const epilogueBarks: Bark[] | null =
    story?.epilogueActive && story.epilogueLines ? story.epilogueLines : null;

  // Announce the identity change when the user signs in — the guest name field
  // is replaced by "Playing as X" elsewhere on screen, so a screen reader user
  // gets no confirmation of their new leaderboard name otherwise (a11y review).
  // Fires only on the sign-out → sign-in transition, never on initial load.
  const wasSignedIn = useRef(isSignedIn);
  useEffect(() => {
    if (isSignedIn === true && wasSignedIn.current === false) {
      announce(
        `Signed in. Playing as ${accountHandle}. This is your leaderboard name.`,
      );
    }
    wasSignedIn.current = isSignedIn;
  }, [isSignedIn, accountHandle, announce]);

  // Client-only initialization.
  useEffect(() => {
    setPlayerKey(getPlayerKey());
    setName(getStoredName());
    const loaded = loadSettings();
    applyMotionPreference(loaded.reducedMotion);
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

  const addCaption = useCallback(
    (speaker: CaptionLine["speaker"], text: string) => {
      captionSeq.current += 1;
      const seq = captionSeq.current;
      setCaptions((prev) => [...prev.slice(-9), { seq, speaker, text }]);
    },
    [],
  );

  const playHostClip = useCallback(
    async (audioPath: string) => {
      stopMysteryClip();
      const release = musicRef.current?.duck() ?? (() => {});
      try {
        await playerRef.current?.play(audioPath);
      } finally {
        release();
      }
    },
    [stopMysteryClip],
  );

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
   * screen reader users miss nothing. Every line carries its speaker's name
   * in both text channels — captions and announcements — so callers are
   * never misattributed to Clyde (a11y consult, Boss Calls).
   */
  const speakHostLine = useCallback(
    (
      text: string,
      audioPath: string | undefined,
      bundle: string[] | null,
      speaker = "Clyde",
    ): Promise<void> => {
      addCaption(speaker, text);
      if (audioPath && playerRef.current && !playerRef.current.paused) {
        return playHostClip(audioPath);
      }
      if (bundle) {
        bundle.push(`${speaker}: ${text}`);
      } else {
        announce(`${speaker}: ${text}`);
      }
      return Promise.resolve();
    },
    [addCaption, announce, playHostClip],
  );

  const playBark = useCallback(
    (trigger: string, bundle: string[] | null) => {
      const bark = pickBark(trigger, epilogueBarks);
      if (!bark) return;
      speakHostLine(
        bark.text,
        manifestRef.current.barks[bark.id] ??
          manifestRef.current.story[bark.id],
        bundle,
      );
    },
    [epilogueBarks, speakHostLine],
  );

  /** A caller's voiced line (their own ElevenLabs voice), speaker-attributed. */
  const speakCallerLine = useCallback(
    (
      callerKey: string,
      callerName: string,
      moment: string,
      bundle: string[] | null,
    ): Promise<void> => {
      const bark = pickBark(`boss-${callerKey}-${moment}`, null);
      if (!bark) return Promise.resolve();
      return speakHostLine(
        bark.text,
        manifestRef.current.barks[bark.id],
        bundle,
        callerName,
      );
    },
    [speakHostLine],
  );

  /** Producer output: device voice when enabled, otherwise the polite live region. */
  const producerSay = useCallback(
    (
      trigger: string,
      values: Record<string, string | number>,
      bundle: string[] | null,
    ) => {
      const text = producerLine(
        trigger,
        values,
        story?.epilogueActive ?? false,
      );
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
    } else if (
      phase.kind === "question" ||
      phase.kind === "feedback" ||
      phase.kind === "tape" ||
      phase.kind === "draft" ||
      phase.kind === "bossReward"
    ) {
      // The draft and the caller's reward screen keep the question bed
      // running deliberately — still mid-episode (explicit, not fallthrough).
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

  const beginRun = useCallback(
    async (daily: boolean) => {
      if (!playerKey || busy) return;
      setBusy(true);
      setErrorText(null);
      resetCopyFallback();
      announce("Starting the broadcast…");
      try {
        initSpeech(); // user gesture: unlock speechSynthesis
        playerRef.current?.unlock(); // unlock HTML media before async mutations
        musicRef.current?.ensureStarted(); // same gesture unlocks the AudioContext
        const trimmed = name.trim();
        await ensurePlayer({
          playerKey,
          displayName: trimmed.length > 0 ? trimmed : undefined,
        });
        if (trimmed.length > 0) storeName(trimmed);
        const started = await startRunMutation({ playerKey, daily });
        setRun(started.run as RunState);
        setQuestion(started.question);
        setQuestionNumber(started.run.questionNumber);
        setChosenIndex(null);
        setBoosts(started.boosts as BoostState);
        setDraftChosen(null);
        // Both resume paths re-anchor the night's condition (a11y consult).
        const conditions = started.run.mutator
          ? ` Conditions: ${started.run.mutator.name}.`
          : "";
        if (started.resumed && !started.question && started.run.bossCall) {
          // The daily was left mid-boss-call: same caller, same question.
          const boss = started.run.bossCall;
          if (boss.phase === "question" && boss.question) {
            setQuestion(boss.question);
            setPhase({ kind: "question" });
            announce(
              `Resuming tonight's broadcast.${conditions} Caller on the line: ${boss.callerName}. One question. No lives at stake.`,
            );
            serveQuestionAudio(boss.question.key);
          } else {
            setRewardChosen(null);
            setPhase({ kind: "bossReward" });
            announce(
              `Resuming tonight's broadcast.${conditions} ${boss.callerName} is pleased — choose your reward. 3 options.`,
            );
          }
        } else if (started.resumed && !started.question) {
          // The daily was left mid-draft: re-enter the draft with the same
          // persisted offer (the server never re-rolls it).
          setPhase({ kind: "draft" });
          announce(
            `Resuming tonight's broadcast.${conditions} Round ${started.run.round - 1} complete. Choose your Signal Boost. ${started.boosts.offer?.length ?? 3} options.`,
          );
        } else if (started.resumed && started.question) {
          // Tonight's daily was already in progress: the server hands the
          // attempt back mid-episode. No show-open — its "first theme" and
          // "first question" copy would be false. Mirror resumeRun instead.
          setPhase({ kind: "question" });
          serveQuestionAudio(started.question.key);
          announce(
            started.run.deadAir
              ? // The redemption question isn't themed; the stakes are the context.
                `Resuming tonight's broadcast.${conditions} Dead air — one final question. Get it right and you stay on the air.`
              : `Resuming tonight's broadcast.${conditions} Question ${started.run.questionNumber}, round ${started.run.round}. Theme: ${categoryLabel(started.run.roundCategory as string | null)}.`,
          );
        } else {
          // The show opens before the first question: title theme under Clyde's
          // greeting, then the player advances at their own pace (no timers).
          setPhase({
            kind: "intro",
            runNumber: started.runNumber,
            isDaily: daily,
          });
          const bundle: string[] = [];
          if (daily) {
            // The greeting and the mutator line must play in SEQUENCE — the
            // audio player stops the current clip when a new one starts, so
            // firing both in the same tick silences the greeting (a11y delta).
            const greet = pickBark("daily-intro", epilogueBarks);
            const greetDone = greet
              ? speakHostLine(
                  greet.text,
                  manifestRef.current.barks[greet.id],
                  bundle,
                )
              : Promise.resolve();
            if (started.run.mutator) {
              const mutator = started.run.mutator;
              const clip =
                manifestRef.current.barks[`mutator-intro-${mutator.key}`];
              if (clip && playerRef.current && !playerRef.current.paused) {
                void greetDone.then(() =>
                  speakHostLine(mutator.intro, clip, null),
                );
              } else {
                void speakHostLine(mutator.intro, undefined, bundle);
              }
              // The canonical system line: the rules always live here, never
              // only in Clyde's flavor line (a11y consult).
              bundle.push(
                `Tonight's broadcast conditions: ${mutator.name}. ${mutator.rules}`,
              );
            }
          } else {
            playBark(
              started.runNumber > 1 ? "run-intro-returning" : "run-intro",
              bundle,
            );
          }
          producerSay(
            "run-intro",
            { name: trimmed || "friend", runNumber: started.runNumber },
            bundle,
          );
          bundle.push(
            `Tonight's first theme: ${categoryLabel(started.run.roundCategory as string | null)}.`,
          );
          bundle.forEach((line) => announce(line));
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Something went wrong.";
        const friendly = message.includes("already aired")
          ? "Tonight's broadcast has already aired for you. Come back tomorrow!"
          : "The signal dropped. Please try again.";
        setErrorText(friendly);
        announce(friendly, "alert");
      } finally {
        setBusy(false);
      }
    },
    [
      announce,
      busy,
      ensurePlayer,
      epilogueBarks,
      name,
      playBark,
      playerKey,
      producerSay,
      resetCopyFallback,
      serveQuestionAudio,
      speakHostLine,
      startRunMutation,
    ],
  );

  const resumeRun = useCallback(() => {
    if (!resumable) return;
    initSpeech(); // user gesture: unlock speechSynthesis for the resumed run too
    playerRef.current?.unlock();
    musicRef.current?.ensureStarted();
    setRun(resumable.run as RunState);
    setQuestion(resumable.question);
    setQuestionNumber(resumable.run.questionNumber);
    setChosenIndex(null);
    setBoosts(resumable.boosts as BoostState);
    setDraftChosen(null);
    // No show-open on resume: the player is mid-episode, get them back fast.
    const conditions = resumable.run.mutator
      ? ` Conditions: ${resumable.run.mutator.name}.`
      : "";
    if (!resumable.question && resumable.run.bossCall) {
      const boss = resumable.run.bossCall;
      if (boss.phase === "question" && boss.question) {
        setQuestion(boss.question);
        setPhase({ kind: "question" });
        announce(
          `Resuming the broadcast.${conditions} Caller on the line: ${boss.callerName}. One question. No lives at stake.`,
        );
        serveQuestionAudio(boss.question.key);
      } else {
        setRewardChosen(null);
        setPhase({ kind: "bossReward" });
        announce(
          `Resuming the broadcast.${conditions} ${boss.callerName} is pleased — choose your reward. 3 options.`,
        );
      }
      return;
    }
    if (!resumable.question && resumable.run.drafting) {
      setPhase({ kind: "draft" });
      announce(
        `Resuming the broadcast.${conditions} Round ${resumable.run.round - 1} complete. Choose your Signal Boost. ${resumable.boosts.offer?.length ?? 3} options.`,
      );
      return;
    }
    if (!resumable.question) return; // defensive: nothing to resume into
    setPhase({ kind: "question" });
    if (resumable.run.deadAir) {
      announce(
        `Resuming the broadcast.${conditions} Dead air — one final question. Get it right and you stay on the air.`,
      );
    } else if (conditions) {
      announce(`Resuming the broadcast.${conditions}`);
    }
    serveQuestionAudio(resumable.question.key);
  }, [announce, resumable, serveQuestionAudio]);

  /** Leaves the on-air intro for the first question. */
  const beginQuestions = useCallback(() => {
    if (!question) return;
    setPhase({ kind: "question" });
    serveQuestionAudio(question.key);
  }, [question, serveQuestionAudio]);

  /** Boss Call answers: no scoring, no life risk, caller-voiced reactions. */
  const answerCaller = useCallback(
    async (index: number) => {
      if (!run?.bossCall || !question || chosenIndex !== null || busy) return;
      stopMysteryClip();
      if (boosts?.eliminatedChoices.includes(index)) {
        announce(`Choice ${index + 1} is eliminated.`);
        return;
      }
      const { caller, callerName } = run.bossCall;
      setBusy(true);
      setChosenIndex(index);
      try {
        const result = (await answerBossCallMutation({
          playerKey,
          runId: run.runId,
          choiceIndex: index,
        })) as AnswerResult;
        setRun(result.run);
        setBoosts(result.boosts);
        const bundle: string[] = [];
        musicRef.current?.playEffect(
          result.correct ? STINGS.correct : STINGS.wrong,
        );
        // The caller reacts in their own voice — no Clyde bark, and never the
        // last-life audio: no lives are at stake here (a11y consult).
        void speakCallerLine(
          caller,
          callerName,
          result.correct ? "pleased" : "disappointed",
          bundle,
        );
        if (result.correct) {
          bundle.push(`Correct! ${callerName} is pleased.`);
        } else {
          bundle.push(
            `Wrong. The correct answer was: ${question.choices[result.correctIndex]}.`,
          );
          bundle.push("No harm done — no lives at stake on caller questions.");
        }
        if (result.explanation) bundle.push(result.explanation);
        bundle.forEach((line) => announce(line));
        // The caller framing must survive into the re-readable feedback
        // panel — live run state forgets the call once it's answered.
        setPhase({
          kind: "feedback",
          result,
          callerContext: `Caller on the line: ${callerName} · one question, no lives at stake`,
        });
      } catch {
        setChosenIndex(null);
        announce(
          "The signal dropped. Your answer didn't go through — try again.",
          "alert",
        );
      } finally {
        setBusy(false);
      }
    },
    [
      announce,
      answerBossCallMutation,
      boosts?.eliminatedChoices,
      busy,
      chosenIndex,
      playerKey,
      question,
      run,
      speakCallerLine,
      stopMysteryClip,
    ],
  );

  const chooseAnswer = useCallback(
    async (index: number) => {
      if (!run || !question || chosenIndex !== null || busy) return;
      stopMysteryClip();
      if (run.bossCall?.phase === "question") {
        // The caller question rides the same panel but its own mutation.
        await answerCaller(index);
        return;
      }
      if (boosts?.eliminatedChoices.includes(index)) {
        // Never a silent no-op: the player (or their shortcut key) hit a
        // choice Static Filter already removed.
        announce(`Choice ${index + 1} is eliminated.`);
        return;
      }
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
        setBoosts(result.boosts);

        const bundle: string[] = [];
        // Earcons fire immediately, at low gain, outside the ducking chain, and
        // never replace announcements (a11y review: reinforcement only).
        const music = musicRef.current;
        music?.playEffect(result.correct ? STINGS.correct : STINGS.wrong);
        if (
          result.run.lives === 1 &&
          !result.correct &&
          result.run.status === "active"
        ) {
          music?.playEffect(STINGS.lastLife);
        }
        for (const event of result.events) {
          if (event.type === "roundComplete") music?.playEffect(STINGS.round);
          else if (event.type === "lifeGained")
            music?.playEffect(STINGS.lifeGained);
          else if (event.type === "tapeUnlocked")
            music?.playEffect(STINGS.tapeFound);
          else if (event.type === "gameOver" && event.isPersonalBest)
            music?.playEffect(STINGS.highScore);
        }
        playBark(result.correct ? "correct" : "wrong", bundle);
        if (result.correct) {
          bundle.push(`Correct! Plus ${result.scoreDelta} points.`);
        } else {
          bundle.push(
            `Wrong. The correct answer was: ${question.choices[result.correctIndex]}.`,
          );
        }
        if (result.explanation) bundle.push(result.explanation);
        if (result.events.some((e) => e.type === "deadAirSurvived")) {
          // Revival lands BEFORE the canonical status line (a11y consult:
          // bark first, status last).
          music?.playEffect(STINGS.lifeGained);
          playBark("dead-air-survived", bundle);
          // No life count here — a survival that also completes a round can
          // change lives again; the canonical status line right after is the
          // authoritative count (a11y delta).
          bundle.push("You're back on the air.");
        }
        bundle.push(
          `Score ${result.run.score}. ${result.run.lives} ${result.run.lives === 1 ? "life" : "lives"}.` +
            (result.run.streak >= 2 ? ` Streak ${result.run.streak}.` : ""),
        );
        if (
          result.run.lives === 1 &&
          !result.correct &&
          result.run.status === "active"
        ) {
          playBark("last-life", bundle);
        }
        // Flat Rates night: streaks pay nothing, so celebrating one is
        // confusing audio — the streak bark stays quiet (a11y consult).
        if (
          result.run.streak > 0 &&
          result.run.streak % 5 === 0 &&
          result.run.mutator?.key !== "flat-rates"
        ) {
          playBark("streak", bundle);
        }
        for (const event of result.events) {
          if (event.type === "roundComplete") {
            // The next theme is NOT announced here: it isn't chosen until the
            // Signal Boost draft resolves (announced at draft exit instead).
            playBark("round-transition", bundle);
            producerSay("round-transition", { round: event.round + 1 }, bundle);
          } else if (event.type === "boostTriggered") {
            // Passive boosts are never silent — their effect rides the same
            // feedback utterance (a11y review).
            bundle.push(event.detail);
          } else if (event.type === "signalGained") {
            // Same framing as the status row so the ephemeral announcement
            // and the re-checkable record match (a11y consult).
            bundle.push(`Signal strength up. ${event.strength} of 3 stored.`);
          } else if (event.type === "bossCall") {
            // Name the voice before it ever speaks: system line here, the
            // caller's own voiced intro after "Take the call" (a11y consult).
            playBark("boss-call", bundle);
            bundle.push(
              `Caller on the line: ${event.name}. One question. No lives at stake.`,
            );
          } else if (event.type === "deadAir") {
            // After the status line, so "0 lives" is heard before the
            // reprieve (a11y consult: state first, twist second).
            music?.playEffect(STINGS.lastLife);
            playBark("dead-air", bundle);
            bundle.push(
              "Dead air. One final question — get it right and you stay on the air.",
            );
          } else if (event.type === "lifeGained") {
            bundle.push(`Life regained. ${event.lives} lives.`);
          } else if (event.type === "achievement") {
            producerSay("achievement", { achievementName: event.name }, bundle);
          } else if (event.type === "tapeUnlocked") {
            playBark("tape-found", bundle);
            producerSay(
              "tape-found",
              { tapeNumber: event.order, tapeTotal: event.total },
              bundle,
            );
          } else if (event.type === "gameOver") {
            playBark(event.isPersonalBest ? "high-score" : "game-over", bundle);
            if (result.run.mutator)
              bundle.push(`Conditions were ${result.run.mutator.name}.`);
            producerSay(
              "game-over",
              { score: event.score, round: event.round },
              bundle,
            );
          }
        }
        bundle.forEach((line) => announce(line));
        setPhase({ kind: "feedback", result });
      } catch {
        setChosenIndex(null);
        announce(
          "The signal dropped. Your answer didn't go through — try again.",
          "alert",
        );
      } finally {
        setBusy(false);
      }
    },
    [
      announce,
      answerCaller,
      boosts?.eliminatedChoices,
      busy,
      chosenIndex,
      playBark,
      playerKey,
      producerSay,
      question,
      run,
      stopMysteryClip,
      submitAnswerMutation,
    ],
  );

  const advanceAfterFeedback = useCallback(
    async (result: AnswerResult, pending: GameEvent[]) => {
      const [next, ...rest] = pending;
      if (next?.type === "tapeUnlocked") {
        const tape = story?.tapes.find((t) => t.id === next.id);
        if (tape) {
          const audioPath = manifestRef.current.story[tape.id];
          if (audioPath && playerRef.current && !playerRef.current.paused)
            void playHostClip(audioPath);
          setPhase({ kind: "tape", tape, pending: rest, result });
          return;
        }
        await advanceAfterFeedback(result, rest);
        return;
      }
      if (next?.type === "finaleReady") {
        try {
          const finale = await completeFinaleMutation({ playerKey });
          setPhase({
            kind: "finale",
            lines: finale.lines,
            pending: rest,
            result,
          });
          const first = finale.lines[0];
          const audioPath = manifestRef.current.story[first.id];
          if (audioPath && playerRef.current && !playerRef.current.paused)
            void playHostClip(audioPath);
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
        // Kept infrequent so it stays charming at question three hundred —
        // and never before the Dead Air redemption (wrong moment for trivia).
        const roll = Math.random();
        const flavor = result.run.deadAir
          ? null
          : roll < 0.2
            ? pickBark("fact", epilogueBarks)
            : roll < 0.5
              ? pickBark("question-lead-in", epilogueBarks)
              : null;
        const flavorDone = flavor
          ? speakHostLine(
              flavor.text,
              manifestRef.current.barks[flavor.id],
              null,
            )
          : Promise.resolve();
        const nextKey = result.nextQuestion.key;
        setQuestion(result.nextQuestion);
        setQuestionNumber(result.run.questionNumber);
        setChosenIndex(null);
        setPhase({ kind: "question" });
        void flavorDone.then(() => serveQuestionAudio(nextKey));
      } else if (
        result.run.bossCall?.phase === "question" &&
        result.run.bossCall.question
      ) {
        // Taking the call: the caller question rides the normal question
        // panel; the caller was named in the feedback bundle, and their
        // voiced intro plays before Clyde relays the question clip.
        const boss = result.run.bossCall;
        const bossQuestion = boss.question!;
        setQuestion(bossQuestion);
        setQuestionNumber(result.run.questionNumber);
        setChosenIndex(null);
        setPhase({ kind: "question" });
        announce(
          `Caller on the line: ${boss.callerName}. One question. No lives at stake.`,
        );
        void speakCallerLine(boss.caller, boss.callerName, "intro", null).then(
          () => serveQuestionAudio(bossQuestion.key),
        );
      } else if (result.run.bossCall?.phase === "reward") {
        setRewardChosen(null);
        setPhase({ kind: "bossReward" });
        announce("Choose your reward. 3 options.");
      } else if (result.run.status === "active" && result.run.drafting) {
        // Between rounds: the Signal Boost draft. Short announcement only —
        // the option buttons carry their own rules text (a11y review).
        setDraftChosen(null);
        setPhase({ kind: "draft" });
        playBark("boost-offer", null);
        announce(
          `Round ${result.run.round - 1} complete. Choose your Signal Boost. ${result.boosts.offer?.length ?? 3} options.`,
        );
      } else {
        setPhase({ kind: "gameover", result });
      }
    },
    [
      announce,
      completeFinaleMutation,
      epilogueBarks,
      playBark,
      playerKey,
      playHostClip,
      serveQuestionAudio,
      speakCallerLine,
      speakHostLine,
      story?.tapes,
    ],
  );

  /** Resolves the won Boss Call, then rolls straight into the boost draft. */
  const pickReward = useCallback(
    async (reward: "life" | "points" | "filter") => {
      if (!run || rewardChosen !== null || busy) return;
      setBusy(true);
      setRewardChosen(reward);
      try {
        const res = await chooseBossRewardMutation({
          playerKey,
          runId: run.runId,
          reward,
        });
        const nextRun = res.run as RunState;
        const nextBoosts = res.boosts as BoostState;
        setRun(nextRun);
        setBoosts(nextBoosts);
        const bundle: string[] = [];
        // Reward outcome leads; the draft entry follows in the same
        // utterance (a11y consult: never let the draft announcement fire
        // without the reward outcome leading it).
        for (const event of res.events as GameEvent[]) {
          if (event.type === "lifeGained") {
            musicRef.current?.playEffect(STINGS.lifeGained);
            bundle.push(`Extra life taken. ${event.lives} lives.`);
          } else if (event.type === "bossRewardChosen") {
            bundle.push(event.detail);
          }
        }
        setDraftChosen(null);
        // Brief hold so a number key meant for the reward can't land on the
        // draft that replaces it (a11y consult).
        shortcutHoldUntil.current = Date.now() + 800;
        setPhase({ kind: "draft" });
        playBark("boost-offer", null);
        bundle.push(
          `Round ${nextRun.round - 1} complete. Choose your Signal Boost. ${nextBoosts.offer?.length ?? 3} options.`,
        );
        bundle.forEach((line) => announce(line));
      } catch {
        setRewardChosen(null);
        announce(
          "The signal dropped. Your pick didn't go through — try again.",
          "alert",
        );
      } finally {
        setBusy(false);
      }
    },
    [
      announce,
      busy,
      chooseBossRewardMutation,
      playBark,
      playerKey,
      rewardChosen,
      run,
    ],
  );

  /** Takes the drafted boost; the server applies it and opens the next round. */
  const pickBoost = useCallback(
    async (boostKey: string) => {
      if (!run || draftChosen !== null || busy) return;
      setBusy(true);
      setDraftChosen(boostKey);
      try {
        const offerEntry = boosts?.offer?.find((b) => b.key === boostKey);
        const drafted = await chooseBoostMutation({
          playerKey,
          runId: run.runId,
          boostKey,
        });
        setRun(drafted.run as RunState);
        setBoosts(drafted.boosts as BoostState);
        const bundle: string[] = [];
        // Clyde reads the chosen boost's tagline (voiced clip when it exists),
        // then a short confirmation bark.
        if (offerEntry) {
          void speakHostLine(
            offerEntry.tagline,
            manifestRef.current.barks[`boost-tagline-${boostKey}`],
            bundle,
          );
        }
        playBark("boost-chosen", bundle);
        for (const event of drafted.events as GameEvent[]) {
          if (event.type === "boostChosen") {
            bundle.push(`${event.name} is yours.`);
          } else if (event.type === "boostTriggered") {
            bundle.push(event.detail);
          } else if (event.type === "lifeGained") {
            musicRef.current?.playEffect(STINGS.lifeGained);
            bundle.push(`Life regained. ${event.lives} lives.`);
          } else if (event.type === "gameOver") {
            // Bank exhausted during the draft: same sign-off as chooseAnswer.
            playBark(event.isPersonalBest ? "high-score" : "game-over", bundle);
            if (drafted.run.mutator)
              bundle.push(`Conditions were ${drafted.run.mutator.name}.`);
            producerSay(
              "game-over",
              { score: event.score, round: event.round },
              bundle,
            );
          }
        }
        if (drafted.question) {
          // The theme is announced here, at draft exit — the moment it's true.
          // Announce BEFORE the phase change so confirmation → theme lands
          // ahead of the question heading focus (parity with chooseAnswer).
          bundle.push(
            `Round ${drafted.run.round}. Theme: ${categoryLabel(drafted.run.roundCategory as string | null)}.`,
          );
          bundle.forEach((line) => announce(line));
          const nextKey = drafted.question.key;
          setQuestion(drafted.question);
          setQuestionNumber(drafted.run.questionNumber);
          setChosenIndex(null);
          setPhase({ kind: "question" });
          serveQuestionAudio(nextKey);
        } else {
          // The bank ran dry during the draft — the run ended as a victory lap.
          bundle.forEach((line) => announce(line));
          setPhase({
            kind: "gameover",
            result: {
              correct: true,
              correctIndex: 0,
              explanation: null,
              scoreDelta: 0,
              events: drafted.events as GameEvent[],
              run: drafted.run as RunState,
              boosts: drafted.boosts as BoostState,
              nextQuestion: null,
              disclosure: null,
            },
          });
        }
      } catch {
        setDraftChosen(null);
        announce(
          "The signal dropped. Your pick didn't go through — try again.",
          "alert",
        );
      } finally {
        setBusy(false);
      }
    },
    [
      announce,
      boosts?.offer,
      busy,
      chooseBoostMutation,
      draftChosen,
      playBark,
      playerKey,
      producerSay,
      run,
      serveQuestionAudio,
      speakHostLine,
    ],
  );

  /** Static Filter: burn a charge to strike two wrong choices off the board. */
  const activateStaticFilter = useCallback(async () => {
    if (!run || !question || busy || chosenIndex !== null) return;
    if ((boosts?.eliminatedChoices.length ?? 0) > 0) {
      announce("An elimination is already applied to this question."); // never a silent no-op
      return;
    }
    const chargesLeft =
      boosts?.owned.find((b) => b.key === "static-filter")?.chargesLeft ?? 0;
    if (chargesLeft <= 0) return;
    setBusy(true);
    try {
      const used = await activateBoostMutation({
        playerKey,
        runId: run.runId,
        boostKey: "static-filter",
      });
      setBoosts((prev) =>
        prev
          ? {
              ...prev,
              eliminatedChoices: used.eliminated,
              owned: prev.owned.map((b) =>
                b.key === "static-filter"
                  ? { ...b, chargesLeft: used.chargesLeft }
                  : b,
              ),
            }
          : prev,
      );
      announce(
        `Static Filter applied. Choices ${used.eliminated.map((i: number) => i + 1).join(" and ")} eliminated. ${used.chargesLeft} ${used.chargesLeft === 1 ? "use" : "uses"} left.`,
      );
    } catch {
      announce(
        "The signal dropped. Static Filter didn't go through — try again.",
        "alert",
      );
    } finally {
      setBusy(false);
    }
  }, [
    activateBoostMutation,
    announce,
    boosts,
    busy,
    chosenIndex,
    playerKey,
    question,
    run,
  ]);

  /** Producer's Whisper: spend 1 signal, the Producer strikes one wrong choice. */
  const activateWhisper = useCallback(async () => {
    if (!run || !question || busy || chosenIndex !== null) return;
    if ((boosts?.eliminatedChoices.length ?? 0) > 0) {
      announce("An elimination is already applied to this question."); // never a silent no-op
      return;
    }
    if (run.signalStrength <= 0) return;
    setBusy(true);
    try {
      const used = await whisperMutation({ playerKey, runId: run.runId });
      setRun((prev) =>
        prev ? { ...prev, signalStrength: used.signalLeft } : prev,
      );
      setBoosts((prev) =>
        prev
          ? {
              ...prev,
              eliminatedChoices: [used.eliminated],
              eliminatedBy: "whisper",
            }
          : prev,
      );
      // Split utterance (a11y consult): diegetic flavor through the Producer
      // path (device voice or live region), mechanical confirmation always
      // through announce() — a resource spend can't hinge on device voice.
      producerSay("whisper", { choice: used.eliminated + 1 }, null);
      announce(
        `Choice ${used.eliminated + 1} eliminated. Signal strength: ${used.signalLeft} of 3.`,
      );
    } catch {
      announce(
        "The signal dropped. The whisper didn't go through — try again.",
        "alert",
      );
    } finally {
      setBusy(false);
    }
  }, [
    announce,
    boosts?.eliminatedChoices,
    busy,
    chosenIndex,
    playerKey,
    producerSay,
    question,
    run,
    whisperMutation,
  ]);

  const backToTitle = useCallback(() => {
    playerRef.current?.stop();
    stopProducer();
    setRun(null);
    setQuestion(null);
    setBoosts(null);
    setDraftChosen(null);
    resetCopyFallback();
    returningToTitle.current = true; // focus the title heading, don't let focus die
    setPhase({ kind: "title" });
  }, [resetCopyFallback]);

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

  useGameShortcuts({
    enabled: settings?.numberShortcuts ?? false,
    phase,
    question,
    chosenIndex,
    boosts,
    draftChosen,
    rewardChosen,
    holdUntil: shortcutHoldUntil,
    replayHostClip,
    chooseAnswer,
    pickBoost,
    pickReward,
  });

  const toggleHostPaused = useCallback(() => {
    setHostPaused((prev) => {
      const next = !prev;
      playerRef.current?.setPaused(next);
      return next;
    });
  }, []);

  const statusItems = useMemo(
    () => buildStatusItems(run, boosts),
    [boosts, run],
  );

  if (!settings) {
    return <p className="py-8 text-center">Tuning the signal…</p>;
  }

  if (phase.kind === "title") {
    return (
      <TitleScreen
        accountHandle={accountHandle}
        beginRun={beginRun}
        busy={busy}
        canResume={Boolean(resumable)}
        errorText={errorText}
        musicMuted={musicMuted}
        name={name}
        resumeRun={resumeRun}
        setName={setName}
        titleHeadingRef={titleHeadingRef}
        toggleMusicMuted={toggleMusicMuted}
      />
    );
  }
  return (
    <InGameView
      activateStaticFilter={activateStaticFilter}
      activateWhisper={activateWhisper}
      advanceAfterFeedback={advanceAfterFeedback}
      announce={announce}
      backToTitle={backToTitle}
      beginQuestions={beginQuestions}
      beginRun={beginRun}
      boosts={boosts}
      busy={busy}
      captions={captions}
      chooseAnswer={chooseAnswer}
      chosenIndex={chosenIndex}
      copyDailyResult={copyDailyResult}
      copyFallback={copyFallback}
      copyFallbackRef={copyFallbackRef}
      draftChosen={draftChosen}
      hostPaused={hostPaused}
      musicMuted={musicMuted}
      panelHeadingRef={panelHeadingRef}
      pickBoost={pickBoost}
      pickReward={pickReward}
      prepareMysteryClip={prepareMysteryClip}
      question={question}
      questionHeadingRef={questionHeadingRef}
      questionNumber={questionNumber}
      quitRun={quitRun}
      registerMysteryClipStop={registerMysteryClipStop}
      replayHostClip={replayHostClip}
      rewardChosen={rewardChosen}
      run={run}
      settings={settings}
      statusItems={statusItems}
      suppressMusicForClip={suppressMusicForClip}
      toggleHostPaused={toggleHostPaused}
      toggleMusicMuted={toggleMusicMuted}
      phase={phase}
    />
  );
}
