#!/usr/bin/env node
/**
 * Synthesizes the game's earcons/stings as WAV files — no samples, no
 * dependencies, fully reproducible from this script (run it again and you get
 * bit-identical output; the noise source is a seeded PRNG).
 *
 * Design notes:
 * - Earcons play hundreds of times per player. They are short, soft (peak
 *   -6 dBFS before patina), and land outside sustained speech so they never
 *   fight Clide or a screen reader.
 * - Every earcon is always PAIRED with a text/speech announcement in the game
 *   (accessibility requirement) — these are reinforcement, never the sole
 *   channel for information.
 * - A light shared "broadcast patina" (gentle lowpass + faint tape-noise
 *   floor) makes them sit in the same room as the Suno tracks once those get
 *   the full mastering pass.
 *
 * Usage: node scripts/generate-stings.mjs   → public/audio/trivia/stings/*.wav
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const OUT_DIR = path.join(root, "public/audio/trivia/stings");
const SAMPLE_RATE = 44100;

// --- tiny deterministic PRNG for the noise floor ---
function makePrng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296 - 0.5;
  };
}

// --- synthesis helpers ---

/** Renders one note into buf. Instruments are additive recipes. */
function note(buf, { at, freq, dur, gain = 0.5, instrument = "vibe" }) {
  const start = Math.floor(at * SAMPLE_RATE);
  const length = Math.floor(dur * SAMPLE_RATE);
  const attack = Math.floor(0.005 * SAMPLE_RATE);
  const partials = {
    // warm struck-bar tone: fundamental + soft octave + inharmonic shimmer
    vibe: [
      [1, 1, 4],
      [2, 0.25, 7],
      [5.4, 0.05, 10],
    ],
    // brassy stab: sawtooth-ish harmonic stack, darkened by 1/n^1.3
    brass: [
      [1, 1, 3],
      [2, 0.62, 3.5],
      [3, 0.4, 4],
      [4, 0.28, 4.5],
      [5, 0.2, 5],
      [6, 0.14, 5.5],
    ],
    // music box: bright, bell-like inharmonic partials, fast decay
    musicbox: [
      [1, 1, 6],
      [3.01, 0.35, 9],
      [4.73, 0.18, 12],
    ],
    // low sub pulse
    sub: [
      [1, 1, 2.5],
      [2, 0.12, 4],
    ],
  }[instrument];

  for (let i = 0; i < length; i++) {
    const idx = start + i;
    if (idx >= buf.length) break;
    const t = i / SAMPLE_RATE;
    const env = (i < attack ? i / attack : 1) * Math.exp(-partials[0][2] * t * (1 / dur) * dur);
    let sample = 0;
    for (const [ratio, amp, decay] of partials) {
      sample += amp * Math.exp(-decay * t) * Math.sin(2 * Math.PI * freq * ratio * t);
    }
    buf[idx] += gain * env * sample;
  }
}

/** Gentle one-pole lowpass + faint tape noise + soft clip + normalize. */
function broadcastPatina(buf, prng) {
  const cutoff = 9000;
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / SAMPLE_RATE);
  let lp = 0;
  for (let i = 0; i < buf.length; i++) {
    lp += alpha * (buf[i] - lp);
    const noise = prng() * 0.004; // ≈ -48 dBFS tape floor
    buf[i] = Math.tanh((lp + noise) * 1.2);
  }
  // normalize to -6 dBFS peak
  let peak = 0;
  for (const s of buf) peak = Math.max(peak, Math.abs(s));
  const target = 0.5;
  if (peak > 0) for (let i = 0; i < buf.length; i++) buf[i] = (buf[i] / peak) * target;
  // 10 ms fades
  const fade = Math.floor(0.01 * SAMPLE_RATE);
  for (let i = 0; i < fade; i++) {
    buf[i] *= i / fade;
    buf[buf.length - 1 - i] *= i / fade;
  }
}

function writeWav(filename, buf) {
  const data = Buffer.alloc(44 + buf.length * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + buf.length * 2, 4);
  data.write("WAVE", 8);
  data.write("fmt ", 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); // PCM
  data.writeUInt16LE(1, 22); // mono
  data.writeUInt32LE(SAMPLE_RATE, 24);
  data.writeUInt32LE(SAMPLE_RATE * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(buf.length * 2, 40);
  for (let i = 0; i < buf.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), 44 + i * 2);
  }
  writeFileSync(path.join(OUT_DIR, filename), data);
}

function render(name, seconds, seed, build) {
  const buf = new Float64Array(Math.ceil(seconds * SAMPLE_RATE));
  build(buf);
  broadcastPatina(buf, makePrng(seed));
  writeWav(`${name}.wav`, buf);
  let peak = 0;
  for (const s of buf) peak = Math.max(peak, Math.abs(s));
  console.log(`${name}.wav  ${seconds.toFixed(2)}s  peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS`);
}

// --- note frequencies ---
const N = {
  Bb3: 233.08, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0,
  A4: 440.0, C5: 523.25, D5: 587.33, E5: 659.26, G5: 783.99, A5: 880.0,
  C6: 1046.5, E6: 1318.5, G6: 1568.0,
};

mkdirSync(OUT_DIR, { recursive: true });

// Correct: quick warm two-note rise. Cheerful, tiny, never grating.
render("correct", 0.7, 101, (buf) => {
  note(buf, { at: 0, freq: N.E5, dur: 0.3, gain: 0.5, instrument: "vibe" });
  note(buf, { at: 0.09, freq: N.A5, dur: 0.55, gain: 0.55, instrument: "vibe" });
});

// Wrong: soft two-note fall. Sympathetic "aw", not a punishment buzzer.
render("wrong", 0.8, 102, (buf) => {
  note(buf, { at: 0, freq: N.D4, dur: 0.35, gain: 0.5, instrument: "vibe" });
  note(buf, { at: 0.12, freq: N.Bb3, dur: 0.6, gain: 0.5, instrument: "vibe" });
});

// Round transition: three-note rising brass stab — the show moving up a gear.
render("round", 1.3, 103, (buf) => {
  note(buf, { at: 0, freq: N.C4, dur: 0.35, gain: 0.4, instrument: "brass" });
  note(buf, { at: 0.16, freq: N.F4, dur: 0.35, gain: 0.42, instrument: "brass" });
  note(buf, { at: 0.32, freq: N.A4, dur: 0.85, gain: 0.46, instrument: "brass" });
  note(buf, { at: 0.32, freq: N.C5, dur: 0.85, gain: 0.2, instrument: "vibe" });
});

// Life gained: warm rising fifth, bell-ish.
render("life-gained", 0.9, 104, (buf) => {
  note(buf, { at: 0, freq: N.C4, dur: 0.4, gain: 0.45, instrument: "vibe" });
  note(buf, { at: 0.14, freq: N.G4, dur: 0.7, gain: 0.5, instrument: "vibe" });
});

// Last life: low pulse under a held minor tone — tension without alarm.
render("last-life", 1.6, 105, (buf) => {
  note(buf, { at: 0, freq: 65.41, dur: 0.5, gain: 0.6, instrument: "sub" });
  note(buf, { at: 0.55, freq: 65.41, dur: 0.5, gain: 0.5, instrument: "sub" });
  note(buf, { at: 1.1, freq: 65.41, dur: 0.5, gain: 0.42, instrument: "sub" });
  note(buf, { at: 0, freq: N.C4, dur: 1.5, gain: 0.18, instrument: "vibe" });
  note(buf, { at: 0, freq: 311.13, dur: 1.5, gain: 0.14, instrument: "vibe" }); // Eb4: minor color
});

// Tape found: music-box sparkle drifting upward — the archive coughing up a gift.
render("tape-found", 1.9, 106, (buf) => {
  const melody = [N.C6, N.E6, N.G6, N.E6, N.C6, N.G6];
  melody.forEach((freq, i) => {
    note(buf, { at: i * 0.16, freq: freq * (1 + (i % 2 ? 0.002 : -0.002)), dur: 0.5, gain: 0.4, instrument: "musicbox" });
  });
  note(buf, { at: 1.0, freq: N.C5, dur: 0.8, gain: 0.25, instrument: "vibe" });
});

// High score: fast triumphant arpeggio with a brass cap.
render("high-score", 1.6, 107, (buf) => {
  const arp = [N.C5, N.E5, N.G5, N.C6];
  arp.forEach((freq, i) => {
    note(buf, { at: i * 0.09, freq, dur: 0.35, gain: 0.42, instrument: "vibe" });
  });
  note(buf, { at: 0.38, freq: N.C5, dur: 0.9, gain: 0.4, instrument: "brass" });
  note(buf, { at: 0.38, freq: N.E5, dur: 0.9, gain: 0.3, instrument: "brass" });
  note(buf, { at: 0.38, freq: N.G5, dur: 0.9, gain: 0.25, instrument: "brass" });
});

console.log(`\nWritten to ${path.relative(root, OUT_DIR)}`);
