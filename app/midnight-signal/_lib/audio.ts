// Host audio (pre-generated MP3s) and Producer speech (Web Speech API).
//
// One-voice-per-line rule: callers go through GameApp's speakHostLine, which
// checks the manifest exactly once — audio plays OR the text is announced via
// live region, never both. This module only knows how to play and speak.

export interface AudioManifest {
  barks: Record<string, string>;
  questions: Record<string, string>;
  story: Record<string, string>;
}

export type HostPlaybackOutcome = "played" | "failed" | "stopped" | "unavailable";

let manifestPromise: Promise<AudioManifest> | null = null;

export function fetchManifest(): Promise<AudioManifest> {
  manifestPromise ??= fetch("/audio/trivia/manifest.json")
    .then((res) =>
      res.ok ? res.json() : { barks: {}, questions: {}, story: {} },
    )
    .catch(() => ({ barks: {}, questions: {}, story: {} }));
  return manifestPromise;
}

/** Plays one host clip at a time with pause/resume/replay and independent volume (WCAG 1.4.2). */
export class HostAudioPlayer {
  private audio: HTMLAudioElement | null = null;
  private reusableAudio: HTMLAudioElement | null = null;
  private finishCurrent: ((outcome: HostPlaybackOutcome) => void) | null = null;
  private lastUrl: string | null = null;
  private _volume: number;
  paused = false;

  constructor(volume: number) {
    this._volume = volume;
  }

  /** Unlocks reusable media while the activating button gesture is live. */
  unlock() {
    if (typeof Audio === "undefined") return;
    const audio = this.reusableAudio ?? new Audio();
    this.reusableAudio = audio;
    audio.muted = false;
    audio.volume = 0;
    audio.src =
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
    void audio
      .play()
      .then(() => {
        if (this.audio === audio) return;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        audio.volume = this._volume;
      })
      .catch((error: unknown) => {
        audio.volume = this._volume;
        console.error("[Midnight Signal] Audio unlock failed.", error);
      });
  }

  set volume(value: number) {
    this._volume = value;
    if (this.audio) this.audio.volume = value;
  }

  /** Starts a clip, stopping any current one. Resolves when playback ends or fails. */
  play(url: string): Promise<HostPlaybackOutcome> {
    this.stop();
    this.lastUrl = url;
    if (this.paused) return Promise.resolve("unavailable");
    const audio = this.reusableAudio ?? new Audio();
    this.reusableAudio = audio;
    audio.muted = false;
    audio.src = url;
    audio.volume = this._volume;
    this.audio = audio;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (outcome: HostPlaybackOutcome) => {
        if (settled) return;
        settled = true;
        audio.onended = null;
        audio.onerror = null;
        if (this.audio === audio) this.audio = null;
        if (this.finishCurrent === finish) this.finishCurrent = null;
        resolve(outcome);
      };
      this.finishCurrent = finish;
      audio.onended = () => finish("played");
      audio.onerror = () => finish("failed");
      audio.play().catch((error: unknown) => {
        console.error("[Midnight Signal] Host audio playback failed.", error);
        finish("failed");
      });
    });
  }

  replayLast(): Promise<HostPlaybackOutcome> {
    if (!this.lastUrl) return Promise.resolve("unavailable");
    this.paused = false;
    return this.play(this.lastUrl);
  }

  /** Registers a clip as "last line" without playing it, so Replay/R can serve it on demand. */
  prime(url: string) {
    this.lastUrl = url;
  }

  /** Pause toggle: also blocks future auto-play until resumed. */
  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) {
      this.audio?.pause();
    } else if (this.audio && this.audio.paused && !this.audio.ended) {
      this.audio.play().catch(() => undefined);
    }
  }

  stop() {
    const audio = this.audio;
    const finish = this.finishCurrent;
    this.audio = null;
    this.finishCurrent = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
    finish?.("stopped");
  }
}

// --- Producer speech (speechSynthesis) ---

let currentUtterance: SpeechSynthesisUtterance | null = null; // hold a ref: GC kills speech mid-utterance
const activeSpeechFinishes = new Set<() => void>();
let speechReady = false;

/** Must be called from a user gesture (Start Broadcast) before first speak. */
export function initSpeech() {
  if (
    speechReady ||
    typeof window === "undefined" ||
    !("speechSynthesis" in window)
  )
    return;
  // A silent utterance from a gesture unlocks speech in gesture-gated browsers.
  const warmup = new SpeechSynthesisUtterance("");
  warmup.volume = 0;
  window.speechSynthesis.speak(warmup);
  speechReady = true;
}

/**
 * Speaks a Producer line. Resolves when the utterance finishes — via onend,
 * onerror, or a text-length safety timeout, because Chrome's onend is
 * unreliable and callers use this to release music ducking.
 */
export function speakProducer(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resolve();
      return;
    }
    // Do NOT cancel here: several Producer lines can fire on one answer (round +
    // achievement + tape) and cancelling would drop all but the last (a11y
    // review P0-2). Deliberate interruption goes through stopProducer().
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 0.7; // the Producer is a machine and proud of it
    currentUtterance = utterance;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(safety);
      activeSpeechFinishes.delete(finish);
      if (currentUtterance === utterance) currentUtterance = null;
      resolve();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    const safety = setTimeout(finish, Math.min(20000, 2000 + text.length * 80));
    activeSpeechFinishes.add(finish);
    window.speechSynthesis.speak(utterance);
  });
}

export function stopProducer() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  for (const finish of [...activeSpeechFinishes]) finish();
  currentUtterance = null;
}
