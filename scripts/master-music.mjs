#!/usr/bin/env node
/**
 * Masters the Suno-generated soundtrack into the shared "broadcast patina" so
 * every track sounds like the same late-night station. Requires ffmpeg.
 *
 * Two treatments:
 * - Composed tracks (title, finale, sign-off): band-limit EQ, subtle tape wow
 *   (slow vibrato), faint pink-noise floor, loudness-normalized to -16 LUFS,
 *   MP3 out.
 * - The question bed LOOP: EQ + static gain only (no wow, no dynamic loudness,
 *   no fades — anything time-varying puts an audible tick at the loop seam),
 *   normalized to -19 LUFS so it naturally sits under speech, WAV out for
 *   gapless Web Audio looping.
 *
 * Source WAVs live outside the repo (Suno exports in ~/Downloads); edit the
 * TRACKS map when re-exporting under different names, then:
 *   node scripts/master-music.mjs [--in <dir>]
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const OUT_DIR = path.join(root, "public/audio/trivia/music");

const args = process.argv.slice(2);
const inDirIndex = args.indexOf("--in");
const IN_DIR =
  inDirIndex >= 0 ? args[inDirIndex + 1] : path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", "Downloads");

const TRACKS = [
  { src: "Midnight Signal (Title Theme).wav", out: "title-theme.mp3", role: "composed" },
  { src: "Midnight Signal (Channel 100 finale).wav", out: "channel-100.mp3", role: "composed" },
  { src: "Midnight Signal (sign-off).wav", out: "sign-off.mp3", role: "composed" },
  {
    src: "Smoky Late-night Quiz Show Thinking Music, Cool Minor-key Groove, Walking Upr....wav",
    out: "question-bed.wav",
    role: "loop",
  },
];

// Shared tonal patina: trim rumble, soften the extreme top like a vintage chain.
const EQ = "highpass=f=45,lowpass=f=11000";
// Tape wow for composed tracks only: 0.55 Hz slow pitch drift, very shallow.
const WOW = "vibrato=f=0.55:d=0.04";

function measureLoudness(file) {
  // Two-pass: measure integrated loudness, then apply a STATIC gain (seam-safe).
  // loudnorm prints its JSON report to stderr.
  const result = spawnSync(
    "ffmpeg",
    ["-i", file, "-af", "loudnorm=I=-19:TP=-1.5:print_format=json", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  return result.stderr ?? "";
}

function run(argsList) {
  return execFileSync("ffmpeg", argsList, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

mkdirSync(OUT_DIR, { recursive: true });

for (const track of TRACKS) {
  const src = path.join(IN_DIR, track.src);
  if (!existsSync(src)) {
    console.error(`MISSING: ${src} — edit the TRACKS map or pass --in <dir>`);
    process.exitCode = 1;
    continue;
  }
  const out = path.join(OUT_DIR, track.out);

  // Static gain everywhere (measure → volume): preserves Suno's dynamics,
  // keeps loop seams clean, and avoids loudnorm's dynamic mode feeding LAME
  // degenerate samples (lame 3.100 psymodel assert). alimiter guards peaks;
  // s16 into the encoder for the same reason.
  const targetLufs = track.role === "composed" ? -16 : -19;
  const measured = measureLoudness(src);
  const match = /"input_i"\s*:\s*"(-?[\d.]+)"/.exec(measured);
  const inputI = match ? Number(match[1]) : -14;
  const gain = (targetLufs - inputI).toFixed(2);

  if (track.role === "composed") {
    run([
      "-y",
      "-i", src,
      "-filter_complex",
      `[0:a]${EQ},${WOW}[main];anoisesrc=c=pink:a=1:r=48000,volume=-52dB[hiss];` +
        `[main][hiss]amix=inputs=2:duration=first:normalize=0,volume=${gain}dB,` +
        `alimiter=limit=0.85:level=false,aresample=44100,aformat=sample_fmts=s16[outa]`,
      "-map", "[outa]",
      // CBR: lame 3.100's VBR psymodel can assert-crash on some inputs
      "-codec:a", "libmp3lame", "-b:a", "192k",
      out,
    ]);
  } else {
    // Loop: EQ + static gain only — no wow, no hiss, nothing time-varying.
    run([
      "-y",
      "-i", src,
      "-af", `${EQ},volume=${gain}dB,alimiter=limit=0.85:level=false,aresample=44100`,
      "-codec:a", "pcm_s16le",
      out,
    ]);
  }
  console.log(`mastered: ${track.out} (measured ${inputI} LUFS, ${gain} dB static gain)`);
}
