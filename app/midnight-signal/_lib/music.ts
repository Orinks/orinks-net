// Music + earcon engine (Web Audio). Gesture-gated: ensureStarted() must only
// be called from a real button activation (Start/Resume/New broadcast) — never
// from a generic first-gesture listener, which would startle screen reader
// users exploring the page (a11y review).
//
// Graph: loop/once sources → duckGain → musicGain → destination
//        earcon sources    → effectsGain ---------→ destination
// Earcons bypass ducking on purpose: ducking is for speech, and earcons are
// deliberately quiet, short, and never information-bearing on their own.

export const MUSIC_TRACKS = {
  title: "/audio/trivia/music/title-theme.mp3",
  bed: "/audio/trivia/music/question-bed.wav",
  finale: "/audio/trivia/music/channel-100.mp3",
  signoff: "/audio/trivia/music/sign-off.mp3",
} as const;

export const STINGS = {
  correct: "/audio/trivia/stings/correct.wav",
  wrong: "/audio/trivia/stings/wrong.wav",
  round: "/audio/trivia/stings/round.wav",
  lifeGained: "/audio/trivia/stings/life-gained.wav",
  lastLife: "/audio/trivia/stings/last-life.wav",
  tapeFound: "/audio/trivia/stings/tape-found.wav",
  highScore: "/audio/trivia/stings/high-score.wav",
} as const;

const DUCK_LEVEL = 0.35;
const DUCK_RAMP_S = 0.15;
const DUCK_SAFETY_MS = 20000; // a duck may never stick (a11y review P0)
const EFFECTS_LEVEL = 0.5; // ≈ -6 dB relative to speech

export class MusicEngine {
  private ctx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private effectsGain: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private loopSource: AudioBufferSourceNode | null = null;
  private currentTrack: string | null = null;
  private duckCount = 0;
  private volume: number;
  private muted: boolean;
  effectsEnabled: boolean;

  constructor(options: { volume: number; muted: boolean; effectsEnabled: boolean }) {
    this.volume = options.volume;
    this.muted = options.muted;
    this.effectsEnabled = options.effectsEnabled;
  }

  get started() {
    return this.ctx !== null;
  }

  /** Call ONLY from an explicit user activation. Safe to call repeatedly. */
  ensureStarted() {
    if (typeof window === "undefined") return;
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    if (!("AudioContext" in window)) return;
    this.ctx = new AudioContext();
    this.duckGain = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.effectsGain = this.ctx.createGain();
    this.musicGain.gain.value = this.muted ? 0 : this.volume;
    this.effectsGain.gain.value = EFFECTS_LEVEL;
    this.duckGain.connect(this.musicGain);
    this.musicGain.connect(this.ctx.destination);
    this.effectsGain.connect(this.ctx.destination);
  }

  private buffer(url: string): Promise<AudioBuffer | null> {
    let cached = this.buffers.get(url);
    if (!cached) {
      cached = fetch(url)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
        .then((bytes) => this.ctx!.decodeAudioData(bytes))
        .catch(() => null);
      this.buffers.set(url, cached);
    }
    return cached;
  }

  private async playTrack(url: string, loop: boolean) {
    if (!this.ctx || !this.duckGain) return;
    if (this.currentTrack === url) return;
    this.stopMusic();
    this.currentTrack = url;
    const buf = await this.buffer(url);
    // A newer request may have superseded this one while decoding.
    if (!buf || this.currentTrack !== url || !this.ctx || !this.duckGain) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    source.loop = loop;
    if (!loop) {
      source.onended = () => {
        if (this.loopSource === source) {
          this.loopSource = null;
          this.currentTrack = null;
        }
      };
    }
    source.connect(this.duckGain);
    source.start();
    this.loopSource = source;
  }

  playLoop(url: string) {
    return this.playTrack(url, true);
  }

  playOnce(url: string) {
    return this.playTrack(url, false);
  }

  stopMusic() {
    if (this.loopSource) {
      this.loopSource.onended = null;
      try {
        this.loopSource.stop();
      } catch {
        // already stopped
      }
      this.loopSource.disconnect();
      this.loopSource = null;
    }
    this.currentTrack = null;
  }

  playEffect(url: string) {
    if (!this.ctx || !this.effectsGain || !this.effectsEnabled) return;
    void this.buffer(url).then((buf) => {
      if (!buf || !this.ctx || !this.effectsGain) return;
      const source = this.ctx.createBufferSource();
      source.buffer = buf;
      source.connect(this.effectsGain);
      source.start();
    });
  }

  setVolume(volume: number) {
    this.volume = volume;
    if (this.ctx && this.musicGain && !this.muted) {
      this.musicGain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05);
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.ctx && this.musicGain) {
      this.musicGain.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
    }
  }

  /**
   * Ducks music under speech. Returns a release function that is safe to call
   * multiple times; a safety timeout guarantees the duck can never stick even
   * if the caller's completion signal is lost (speechSynthesis.onend is
   * unreliable in Chrome).
   */
  duck(): () => void {
    if (!this.ctx || !this.duckGain) return () => {};
    this.duckCount++;
    this.duckGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.duckGain.gain.linearRampToValueAtTime(DUCK_LEVEL, this.ctx.currentTime + DUCK_RAMP_S);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(safety);
      this.duckCount = Math.max(0, this.duckCount - 1);
      if (this.duckCount === 0 && this.ctx && this.duckGain) {
        this.duckGain.gain.cancelScheduledValues(this.ctx.currentTime);
        this.duckGain.gain.linearRampToValueAtTime(1, this.ctx.currentTime + DUCK_RAMP_S * 2);
      }
    };
    const safety = setTimeout(release, DUCK_SAFETY_MS);
    return release;
  }

  dispose() {
    this.stopMusic();
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}
