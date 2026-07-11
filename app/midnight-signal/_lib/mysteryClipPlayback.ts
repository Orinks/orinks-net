import type { MysteryClipEvent } from "./mysteryClipMachine";

interface ClipAudio {
  src: string;
  preload: string;
  currentTime: number;
  onplaying: ((event: Event) => unknown) | null;
  onended: ((event: Event) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
  play: () => Promise<void>;
  pause: () => void;
  load: () => void;
  removeAttribute: (name: string) => void;
}

interface MysteryClipPlaybackOptions {
  announce: (message: string) => void;
  beforePlay: () => void;
  suppressMusic: () => () => void;
  onState: (event: MysteryClipEvent) => void;
  createAudio?: () => ClipAudio;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

const LOADING_ANNOUNCEMENT_MS = 2000;

/** Owns one streamed mystery clip and guarantees synchronous, idempotent cleanup. */
export class MysteryClipPlayback {
  private readonly options: Required<MysteryClipPlaybackOptions>;
  private audio: ClipAudio | null = null;
  private releaseSuppression: (() => void) | null = null;
  private loadingTimer: ReturnType<typeof setTimeout> | null = null;
  private endingTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private startSeconds = 0;
  private durationSeconds = 0;
  private completed = false;

  constructor(options: MysteryClipPlaybackOptions) {
    this.options = {
      ...options,
      createAudio: options.createAudio ?? (() => new Audio()),
      schedule: options.schedule ?? setTimeout,
      cancelSchedule: options.cancelSchedule ?? clearTimeout,
    };
  }

  get active() {
    return this.audio !== null;
  }

  play(clipId: string, startSeconds = 0, durationSeconds = 12) {
    this.stop(false);
    this.options.beforePlay();
    const attempt = ++this.attempt;
    this.startSeconds = startSeconds;
    this.durationSeconds = durationSeconds;
    this.completed = false;
    this.options.onState({ type: "activate" });
    this.releaseSuppression = this.options.suppressMusic();

    const audio = this.options.createAudio();
    audio.preload = "none";
    audio.src = `/api/midnight-signal/clips/${encodeURIComponent(clipId)}`;
    this.audio = audio;

    const current = () => this.audio === audio && this.attempt === attempt;
    const finish = (type: "ended" | "failed", message: string) => {
      if (!current() || this.completed) return;
      this.completed = true;
      this.clearLoadingTimer();
      this.clearEndingTimer();
      if (type === "failed") this.audio = null;
      this.releaseMusic();
      this.options.onState({ type, attempt });
      this.options.announce(message);
    };

    audio.onplaying = () => {
      if (!current()) return;
      this.clearLoadingTimer();
      if (audio.currentTime < this.startSeconds) audio.currentTime = this.startSeconds;
      this.scheduleEnding(audio, finish);
      this.options.onState({ type: "playing", attempt });
      this.options.announce("Mystery clip playing.");
    };
    audio.onended = () => finish("ended", "Mystery clip finished.");
    audio.onerror = () =>
      finish("failed", "Mystery clip unavailable. Use the text clue, or try again.");
    this.loadingTimer = this.options.schedule(() => {
      if (!current()) return;
      this.options.onState({ type: "loading-announced", attempt });
      this.options.announce("Loading mystery clip.");
    }, LOADING_ANNOUNCEMENT_MS);
    void audio.play().catch(() => {
      finish("failed", "Mystery clip unavailable. Use the text clue, or try again.");
    });
  }

  pause() {
    const audio = this.audio;
    if (!audio) return;
    this.clearLoadingTimer();
    this.clearEndingTimer();
    audio.pause();
    this.releaseMusic();
    this.options.onState({ type: "paused", attempt: this.attempt });
    this.options.announce("Mystery clip paused.");
  }

  resume() {
    const audio = this.audio;
    if (!audio) return;
    this.options.beforePlay();
    this.releaseSuppression = this.options.suppressMusic();
    void audio.play().catch(() => {
      if (this.audio !== audio) return;
      this.audio = null;
      audio.onplaying = null;
      audio.onended = null;
      audio.onerror = null;
      this.releaseMusic();
      this.options.onState({ type: "failed", attempt: this.attempt });
      this.options.announce("Mystery clip unavailable. Use the text clue, or try again.");
    });
  }

  replay() {
    const audio = this.audio;
    if (!audio) return;
    this.completed = false;
    audio.currentTime = this.startSeconds;
    this.resume();
  }

  stop(shouldAnnounce = true) {
    const wasActive = this.audio !== null;
    this.clearLoadingTimer();
    this.clearEndingTimer();
    const audio = this.audio;
    this.audio = null;
    if (!wasActive) {
      this.releaseMusic();
      return;
    }
    this.attempt += 1;
    if (audio) {
      audio.onplaying = null;
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute("src");
      audio.load();
    }
    this.releaseMusic();
    if (wasActive) {
      this.options.onState({ type: "stop" });
      if (shouldAnnounce) this.options.announce("Mystery clip stopped.");
    }
  }

  dispose() {
    this.stop(false);
  }

  private clearLoadingTimer() {
    if (this.loadingTimer !== null) this.options.cancelSchedule(this.loadingTimer);
    this.loadingTimer = null;
  }

  private clearEndingTimer() {
    if (this.endingTimer !== null) this.options.cancelSchedule(this.endingTimer);
    this.endingTimer = null;
  }

  private scheduleEnding(
    audio: ClipAudio,
    finish: (type: "ended" | "failed", message: string) => void,
  ) {
    this.clearEndingTimer();
    const endAt = this.startSeconds + this.durationSeconds;
    const remainingMs = Math.max(0, (endAt - audio.currentTime) * 1000);
    this.endingTimer = this.options.schedule(() => {
      this.endingTimer = null;
      if (this.audio !== audio) return;
      audio.pause();
      audio.currentTime = endAt;
      finish("ended", "Mystery clip finished.");
    }, remainingMs);
  }

  private releaseMusic() {
    this.releaseSuppression?.();
    this.releaseSuppression = null;
  }
}
