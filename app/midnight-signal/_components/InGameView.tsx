"use client";

import Link from "next/link";
import type { RefObject } from "react";
import type { GameSettings } from "../_lib/settings";
import { presentAnswerDisclosure } from "../_lib/answerDisclosure";
import { MysteryClipPlayer } from "./MysteryClipPlayer";
import { StoryBeatPanel } from "./StoryBeatPanel";
import {
  BOSS_REWARDS,
  categoryLabel,
  dailyShareText,
  focusRing,
  primaryButton,
  secondaryButton,
  type AnswerResult,
  type BoostState,
  type CaptionLine,
  type GameEvent,
  type Phase,
  type PublicQuestion,
  type RunState,
} from "./gameTypes";

interface InGameViewProps {
  run: RunState | null;
  statusItems: Array<{ label: string; value: string | number }>;
  phase: Exclude<Phase, { kind: "title" }>;
  panelHeadingRef: RefObject<HTMLHeadingElement | null>;
  questionHeadingRef: RefObject<HTMLHeadingElement | null>;
  beginQuestions: () => void;
  boosts: BoostState | null;
  draftChosen: string | null;
  rewardChosen: string | null;
  settings: GameSettings;
  pickBoost: (key: string) => Promise<void>;
  pickReward: (key: "life" | "points" | "filter") => Promise<void>;
  question: PublicQuestion | null;
  questionNumber: number;
  announce: (message: string) => void;
  prepareMysteryClip: () => void;
  registerMysteryClipStop: (stop: (() => void) | null) => void;
  suppressMusicForClip: () => () => void;
  chosenIndex: number | null;
  chooseAnswer: (index: number) => Promise<void>;
  busy: boolean;
  activateStaticFilter: () => Promise<void>;
  activateWhisper: () => Promise<void>;
  advanceAfterFeedback: (
    result: AnswerResult,
    events: GameEvent[],
  ) => Promise<void>;
  copyDailyResult: (text: string) => Promise<void>;
  copyFallback: boolean;
  copyFallbackRef: RefObject<HTMLTextAreaElement | null>;
  beginRun: (daily: boolean) => Promise<void>;
  backToTitle: () => void;
  replayHostClip: () => Promise<void>;
  toggleHostPaused: () => void;
  hostPaused: boolean;
  hostAudioStatus: string | null;
  toggleMusicMuted: () => void;
  musicMuted: boolean;
  quitRun: () => Promise<void>;
  captions: CaptionLine[];
}

export function InGameView({
  run,
  statusItems,
  phase,
  panelHeadingRef,
  questionHeadingRef,
  beginQuestions,
  boosts,
  draftChosen,
  rewardChosen,
  settings,
  pickBoost,
  pickReward,
  question,
  questionNumber,
  announce,
  prepareMysteryClip,
  registerMysteryClipStop,
  suppressMusicForClip,
  chosenIndex,
  chooseAnswer,
  busy,
  activateStaticFilter,
  activateWhisper,
  advanceAfterFeedback,
  copyDailyResult,
  copyFallback,
  copyFallbackRef,
  beginRun,
  backToTitle,
  replayHostClip,
  toggleHostPaused,
  hostPaused,
  hostAudioStatus,
  toggleMusicMuted,
  musicMuted,
  quitRun,
  captions,
}: InGameViewProps) {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-amber-200">The Midnight Signal</h1>
      {run ? (
        <dl
          aria-label="Run status"
          className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-b border-amber-700 pb-3"
        >
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
          <h2
            className="text-xl font-semibold text-amber-200"
            id="intro-heading"
            ref={panelHeadingRef}
            tabIndex={-1}
          >
            {phase.isDaily
              ? "Tonight's broadcast — on the air"
              : `On the air — Episode ${phase.runNumber}`}
          </h2>
          <p className="mt-2 leading-7">
            The studio lights are up, Clyde is at the desk, and the signal is
            warm. Tonight&apos;s first theme:{" "}
            {categoryLabel(run?.roundCategory)}. The first question comes when
            you&apos;re ready.
          </p>
          {phase.isDaily && run?.mutator ? (
            <p className="mt-2 leading-7 text-amber-100">
              Tonight&apos;s broadcast conditions: {run.mutator.name}.{" "}
              {run.mutator.rules}
            </p>
          ) : null}
          {run?.storyBeat ? (
            <StoryBeatPanel beat={run.storyBeat} isDaily={run.isDaily} />
          ) : null}
          <button
            className={`${primaryButton} mt-4`}
            onClick={beginQuestions}
            type="button"
          >
            Begin the questions
          </button>
        </section>
      ) : null}

      {phase.kind === "draft" && boosts?.offer ? (
        <section aria-labelledby="draft-heading" className="mt-6">
          <h2
            className="text-xl font-semibold text-amber-200"
            id="draft-heading"
            ref={panelHeadingRef}
            tabIndex={-1}
          >
            Round {(run?.round ?? 2) - 1} complete — choose a Signal Boost
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Word from the booth: pick one before we go back on the air. No rush
            — the signal holds.
          </p>
          {run?.storyBeat ? (
            <StoryBeatPanel beat={run.storyBeat} isDaily={run.isDaily} />
          ) : null}
          <div
            aria-labelledby="draft-heading"
            className="mt-4 grid gap-3"
            role="group"
          >
            {boosts.offer.map((boost, index) => (
              <button
                aria-disabled={draftChosen !== null}
                aria-keyshortcuts={
                  settings.numberShortcuts ? String(index + 1) : undefined
                }
                className={`${secondaryButton} justify-start text-left`}
                key={boost.key}
                onClick={() => void pickBoost(boost.key)}
                type="button"
              >
                {index + 1}. {boost.name}. {boost.tagline} {boost.rules}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {phase.kind === "bossReward" && run?.bossCall?.phase === "reward" ? (
        <section aria-labelledby="reward-heading" className="mt-6">
          <h2
            className="text-xl font-semibold text-amber-200"
            id="reward-heading"
            ref={panelHeadingRef}
            tabIndex={-1}
          >
            {run.bossCall.callerName} is pleased — choose your reward
          </h2>
          <div
            aria-labelledby="reward-heading"
            className="mt-4 grid gap-3"
            role="group"
          >
            {BOSS_REWARDS.map((option, index) => (
              <button
                aria-disabled={rewardChosen !== null}
                aria-keyshortcuts={
                  settings.numberShortcuts ? String(index + 1) : undefined
                }
                className={`${secondaryButton} justify-start text-left`}
                key={option.key}
                onClick={() => void pickReward(option.key)}
                type="button"
              >
                {index + 1}. {option.label}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {(phase.kind === "question" || phase.kind === "feedback") && question ? (
        <section aria-labelledby="question-heading" className="mt-6">
          <p className="text-sm text-zinc-400">
            {phase.kind === "feedback" && phase.callerContext
              ? phase.callerContext
              : run?.bossCall?.phase === "question"
                ? `Caller on the line: ${run.bossCall.callerName} · one question, no lives at stake`
                : run?.deadAir
                  ? `Dead air — one final question · Round ${run.round}`
                  : `Question ${questionNumber} · Round ${run?.round} · Theme: ${categoryLabel(run?.roundCategory)}`}
          </p>
          <h2
            className="mt-2 text-xl font-semibold"
            id="question-heading"
            ref={questionHeadingRef}
            tabIndex={-1}
          >
            {question.prompt}
          </h2>
          {question.clip ? (
            <MysteryClipPlayer
              announce={announce}
              answered={phase.kind === "feedback"}
              beforePlay={prepareMysteryClip}
              buttonClassName={secondaryButton}
              clip={question.clip}
              key={question.key}
              registerStop={registerMysteryClipStop}
              suppressMusic={suppressMusicForClip}
              volume={settings.hostVolume}
            />
          ) : null}
          <div
            aria-labelledby="question-heading"
            className="mt-4 grid gap-3"
            role="group"
          >
            {question.choices.map((choice, index) => {
              const eliminated =
                boosts?.eliminatedChoices.includes(index) ?? false;
              return (
                <button
                  aria-disabled={chosenIndex !== null || eliminated}
                  aria-keyshortcuts={
                    settings.numberShortcuts ? String(index + 1) : undefined
                  }
                  className={`${secondaryButton} justify-start text-left ${eliminated ? "line-through opacity-70" : ""}`}
                  key={choice}
                  onClick={() => void chooseAnswer(index)}
                  type="button"
                >
                  {index + 1}.{" "}
                  {eliminated
                    ? boosts?.eliminatedBy === "whisper"
                      ? "(whisper — eliminated) "
                      : "(static — eliminated) "
                    : ""}
                  {choice}
                </button>
              );
            })}
          </div>
          {phase.kind === "question"
            ? (() => {
                const filter = boosts?.owned.find(
                  (b) => b.key === "static-filter",
                );
                const eliminationApplied =
                  (boosts?.eliminatedChoices.length ?? 0) > 0;
                const showFilter =
                  filter &&
                  ((filter.chargesLeft ?? 0) > 0 || eliminationApplied);
                const showWhisper =
                  (run?.signalStrength ?? 0) > 0 || eliminationApplied;
                if (!showFilter && !showWhisper) return null;
                return (
                  <div
                    aria-label="Signal Boosts"
                    className="mt-3 flex flex-wrap gap-3"
                    role="group"
                  >
                    {showFilter ? (
                      <button
                        aria-disabled={
                          busy || chosenIndex !== null || eliminationApplied
                        }
                        className={secondaryButton}
                        onClick={() => void activateStaticFilter()}
                        type="button"
                      >
                        {eliminationApplied
                          ? boosts!.eliminatedBy === "whisper"
                            ? "Static Filter — unavailable, Producer's Whisper used this question"
                            : "Static Filter applied"
                          : `Use Static Filter — ${filter?.chargesLeft ?? 0} left`}
                      </button>
                    ) : null}
                    {showWhisper ? (
                      <button
                        aria-disabled={
                          busy || chosenIndex !== null || eliminationApplied
                        }
                        className={secondaryButton}
                        onClick={() => void activateWhisper()}
                        type="button"
                      >
                        {eliminationApplied
                          ? boosts!.eliminatedBy === "whisper"
                            ? "Producer's Whisper applied"
                            : "Producer's Whisper — unavailable, Static Filter used this question"
                          : `Producer's Whisper — uses 1 signal, ${run?.signalStrength ?? 0} stored`}
                      </button>
                    ) : null}
                  </div>
                );
              })()
            : null}
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
              {phase.result.correct && phase.result.scoreDelta > 0
                ? ` Plus ${phase.result.scoreDelta} points.`
                : ""}
            </p>
          ) : null}
          {phase.result.explanation ? (
            <p className="mt-2 leading-7 text-zinc-400">
              {phase.result.explanation}
            </p>
          ) : null}
          {phase.result.disclosure
            ? (() => {
                const disclosure = presentAnswerDisclosure(
                  phase.result.disclosure,
                );
                return (
                  <div className="mt-4 rounded-md border border-amber-700 p-4">
                    <h3 className="font-semibold text-amber-100">
                      Answer sources and credits
                    </h3>
                    <ul className="mt-2 space-y-2">
                      {disclosure.links.map((link) => (
                        <li key={link.kind}>
                          {link.kind === "official-source"
                            ? "Official source: "
                            : link.kind === "clip-source"
                              ? "Recording: "
                              : "License: "}
                          <a
                            className={`underline ${focusRing}`}
                            href={link.href}
                          >
                            {link.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                    {disclosure.copyrightNotice ? (
                      <p className="mt-2 text-sm leading-6 text-zinc-400">
                        {disclosure.copyrightNotice}
                      </p>
                    ) : null}
                  </div>
                );
              })()
            : null}
          <button
            className={`${primaryButton} mt-4`}
            onClick={() =>
              void advanceAfterFeedback(phase.result, phase.result.events)
            }
            type="button"
          >
            {phase.result.events.some(
              (e) => e.type === "gameOver" || e.type === "bankExhausted",
            )
              ? "Continue"
              : phase.result.run.deadAir
                ? "Face the final question"
                : phase.result.events.some(
                      (e) =>
                        e.type === "tapeUnlocked" || e.type === "finaleReady",
                    )
                  ? // A tape/finale screen serves first; promising the call or
                    // draft here would name the wrong destination.
                    "Continue"
                  : phase.result.run.bossCall?.phase === "question"
                    ? "Take the call"
                    : phase.result.run.bossCall?.phase === "reward"
                      ? "Choose your reward"
                      : phase.result.run.drafting
                        ? "Choose your Signal Boost"
                        : "Next question"}
          </button>
        </section>
      ) : null}

      {phase.kind === "tape" ? (
        <section aria-labelledby="tape-heading" className="mt-6">
          <h2
            className="text-xl font-semibold text-amber-200"
            id="tape-heading"
            ref={panelHeadingRef}
            tabIndex={-1}
          >
            Master tape recovered: {phase.tape.title}
          </h2>
          <p className="mt-3 leading-7">{phase.tape.text}</p>
          <button
            className={`${primaryButton} mt-4`}
            onClick={() =>
              void advanceAfterFeedback(phase.result, phase.pending)
            }
            type="button"
          >
            Continue
          </button>
        </section>
      ) : null}

      {phase.kind === "finale" ? (
        <section aria-labelledby="finale-heading" className="mt-6">
          <h2
            className="text-xl font-semibold text-amber-200"
            id="finale-heading"
            ref={panelHeadingRef}
            tabIndex={-1}
          >
            Channel 100
          </h2>
          {phase.lines.map((line) => (
            <div className="mt-4" key={line.id}>
              {line.title ? (
                <h3 className="font-semibold text-amber-100">{line.title}</h3>
              ) : null}
              <p className="mt-1 leading-7">{line.text}</p>
            </div>
          ))}
          <button
            className={`${primaryButton} mt-6`}
            onClick={() =>
              void advanceAfterFeedback(phase.result, phase.pending)
            }
            type="button"
          >
            Continue
          </button>
        </section>
      ) : null}

      {phase.kind === "gameover" ? (
        <section aria-labelledby="gameover-heading" className="mt-6">
          <h2
            className="text-xl font-semibold text-amber-200"
            id="gameover-heading"
            ref={panelHeadingRef}
            tabIndex={-1}
          >
            Broadcast over
          </h2>
          <p className="mt-2 leading-7">
            Final score {phase.result.run.score}, round {phase.result.run.round}
            .
            {phase.result.events.some(
              (e) => e.type === "gameOver" && e.isPersonalBest,
            )
              ? " That's a new personal best!"
              : ""}
          </p>
          {phase.result.run.isDaily ? (
            <div className="mt-3">
              <p className="leading-7 text-zinc-400">
                {dailyShareText(phase.result.run)}
              </p>
              <button
                className={`${secondaryButton} mt-2`}
                onClick={() =>
                  void copyDailyResult(dailyShareText(phase.result.run))
                }
                type="button"
              >
                Copy tonight&apos;s result
              </button>
              {copyFallback ? (
                <textarea
                  aria-label="Tonight's result, ready to copy"
                  className={`mt-2 w-full rounded-md border border-amber-700 bg-zinc-900 px-3 py-2 text-amber-50 ${focusRing}`}
                  readOnly
                  ref={copyFallbackRef}
                  rows={2}
                  value={dailyShareText(phase.result.run)}
                />
              ) : null}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              className={primaryButton}
              onClick={() => void beginRun(false)}
              type="button"
            >
              Start new broadcast
            </button>
            <Link
              className={secondaryButton}
              href="/midnight-signal/leaderboard"
            >
              View leaderboard
            </Link>
            <button
              className={secondaryButton}
              onClick={backToTitle}
              type="button"
            >
              Back to title
            </button>
          </div>
        </section>
      ) : null}

      <div className="mt-8 flex flex-wrap gap-3 border-t border-amber-700 pt-4">
        <button
          className={secondaryButton}
          onClick={() => void replayHostClip()}
          type="button"
        >
          Replay the last spoken line
        </button>
        <button
          className={secondaryButton}
          onClick={toggleHostPaused}
          type="button"
        >
          {hostPaused ? "Resume host audio" : "Pause host audio"}
        </button>
        <button
          className={secondaryButton}
          onClick={toggleMusicMuted}
          type="button"
        >
          {musicMuted ? "Unmute music" : "Mute music"}
        </button>
        {phase.kind === "intro" ||
        phase.kind === "question" ||
        phase.kind === "feedback" ||
        phase.kind === "draft" ||
        phase.kind === "bossReward" ? (
          <button
            className={secondaryButton}
            onClick={() => void quitRun()}
            type="button"
          >
            Quit run
          </button>
        ) : null}
      </div>
      {hostAudioStatus ? <p className="mt-2 text-sm text-amber-100">{hostAudioStatus}</p> : null}

      {settings.captions && captions.length > 0 ? (
        <section aria-labelledby="captions-heading" className="mt-6">
          <h2
            className="text-sm font-semibold uppercase tracking-wide text-zinc-400"
            id="captions-heading"
          >
            Captions
          </h2>
          <ul className="mt-2 space-y-1 text-sm leading-6 text-zinc-400">
            {captions.map((line) => (
              <li key={line.seq}>
                <span className="font-semibold text-amber-100">
                  {line.speaker}:
                </span>{" "}
                {line.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
