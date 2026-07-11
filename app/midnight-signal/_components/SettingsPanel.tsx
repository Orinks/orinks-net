"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAnnounce } from "./Announcer";
import { stopProducer } from "../_lib/audio";
import { applyMotionPreference, defaultSettings, loadSettings, saveSettings, type GameSettings } from "../_lib/settings";

const focusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";
const buttonStyle = `inline-flex min-h-10 items-center justify-center rounded-md border border-amber-700 px-4 py-2 font-semibold text-amber-100 hover:bg-zinc-900 ${focusRing}`;

export function SettingsPanel() {
  const announce = useAnnounce();
  const [settings, setSettings] = useState<GameSettings>(defaultSettings);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const loaded = loadSettings();
    setSettings(loaded);
    applyMotionPreference(loaded.reducedMotion);
    setLoaded(true);
  }, []);

  const update = (patch: Partial<GameSettings>, confirmation: string) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      if (patch.reducedMotion) applyMotionPreference(next.reducedMotion);
      return next;
    });
    announce(confirmation);
  };

  if (!loaded) return <p>Loading settings…</p>;

  const volumePercent = Math.round(settings.hostVolume * 100);
  const musicPercent = Math.round(settings.musicVolume * 100);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-bold text-amber-200">Settings</h1>
      <p className="mt-3 leading-7">Changes apply immediately and are saved on this device.</p>

      <div className="mt-6 space-y-6">
        <div>
          <label className="block font-semibold text-amber-100" htmlFor="host-volume">
            Host audio volume
          </label>
          <input
            aria-valuetext={`${volumePercent} percent`}
            className={`mt-2 w-full max-w-xs ${focusRing}`}
            id="host-volume"
            max={100}
            min={0}
            onChange={(event) =>
              // No announce() here: the native slider + aria-valuetext already
              // reports each step; announcing too would double-speak.
              setSettings((prev) => {
                const next = { ...prev, hostVolume: Number(event.target.value) / 100 };
                saveSettings(next);
                return next;
              })
            }
            step={10}
            type="range"
            value={volumePercent}
          />
        </div>

        <div>
          <label className="block font-semibold text-amber-100" htmlFor="music-volume">
            Music volume
          </label>
          <input
            aria-describedby="music-volume-help"
            aria-valuetext={`${musicPercent} percent`}
            className={`mt-2 w-full max-w-xs ${focusRing}`}
            id="music-volume"
            max={100}
            min={0}
            onChange={(event) =>
              // Silent like the host slider: aria-valuetext already reports steps.
              setSettings((prev) => {
                const next = { ...prev, musicVolume: Number(event.target.value) / 100 };
                saveSettings(next);
                return next;
              })
            }
            step={10}
            type="range"
            value={musicPercent}
          />
          <p className="mt-1 text-sm leading-6 text-zinc-400" id="music-volume-help">
            Takes effect when you return to the broadcast. During play, the Mute music button
            next to the host audio controls silences it instantly.
          </p>
        </div>

        <div className="flex items-start gap-3">
          <input
            checked={settings.soundEffects}
            className={`mt-1 h-5 w-5 ${focusRing}`}
            id="sound-effects"
            onChange={(event) =>
              update(
                { soundEffects: event.target.checked },
                `Sound effects ${event.target.checked ? "on" : "off"}.`,
              )
            }
            type="checkbox"
          />
          <label htmlFor="sound-effects">
            <span className="font-semibold text-amber-100">Sound effects</span>
            <span className="block text-sm leading-6 text-zinc-400">
              Short musical cues for correct answers, round changes, and tape discoveries. Purely
              decorative — every cue is always paired with a spoken and text announcement.
            </span>
          </label>
        </div>

        <div className="flex items-start gap-3">
          <input
            checked={settings.autoPlayQuestionAudio}
            className={`mt-1 h-5 w-5 ${focusRing}`}
            id="auto-question-audio"
            onChange={(event) =>
              update(
                { autoPlayQuestionAudio: event.target.checked },
                `Question audio auto-play ${event.target.checked ? "on" : "off"}.`,
              )
            }
            type="checkbox"
          />
          <label htmlFor="auto-question-audio">
            <span className="font-semibold text-amber-100">Auto-play question audio</span>
            <span className="block text-sm leading-6 text-zinc-400">
              Clyde reads each question aloud when its recording exists. Turn off if it overlaps
              your screen reader; the R key replays it on demand.
            </span>
          </label>
        </div>

        <div className="flex items-start gap-3">
          <input
            checked={settings.producerVoice}
            className={`mt-1 h-5 w-5 ${focusRing}`}
            id="producer-voice"
            onChange={(event) => {
              if (!event.target.checked) stopProducer();
              update(
                { producerVoice: event.target.checked },
                `Producer voice ${event.target.checked ? "on" : "off"}.`,
              );
            }}
            type="checkbox"
          />
          <label htmlFor="producer-voice">
            <span className="font-semibold text-amber-100">Producer device voice</span>
            <span className="block text-sm leading-6 text-zinc-400">
              The Producer speaks scores and announcements through your device&apos;s speech
              synthesis. When off, the same lines go through your screen reader instead.
            </span>
          </label>
        </div>

        <div className="flex items-start gap-3">
          <input
            checked={settings.captions}
            className={`mt-1 h-5 w-5 ${focusRing}`}
            id="captions"
            onChange={(event) =>
              update({ captions: event.target.checked }, `Captions ${event.target.checked ? "on" : "off"}.`)
            }
            type="checkbox"
          />
          <label htmlFor="captions">
            <span className="font-semibold text-amber-100">Show captions</span>
            <span className="block text-sm leading-6 text-zinc-400">
              A visible log of everything Clyde and the Producer say. Lines without audio are
              always announced to screen readers regardless of this setting.
            </span>
          </label>
        </div>

        <div className="flex items-start gap-3">
          <input
            checked={settings.numberShortcuts}
            className={`mt-1 h-5 w-5 ${focusRing}`}
            id="number-shortcuts"
            onChange={(event) =>
              update(
                { numberShortcuts: event.target.checked },
                `Keyboard shortcuts ${event.target.checked ? "on" : "off"}.`,
              )
            }
            type="checkbox"
          />
          <label htmlFor="number-shortcuts">
            <span className="font-semibold text-amber-100">Keyboard shortcuts</span>
            <span className="block text-sm leading-6 text-zinc-400">
              Number keys 1 to 4 answer questions; R replays Clyde&apos;s last line. Screen reader
              users: these work in focus/forms mode. Tab and Enter always work regardless.
            </span>
          </label>
        </div>

        <div>
          <label className="block font-semibold text-amber-100" htmlFor="reduced-motion">
            Reduce motion
          </label>
          <select
            className={`mt-2 rounded-md border border-amber-700 bg-zinc-900 px-3 py-2 text-amber-50 ${focusRing}`}
            id="reduced-motion"
            onChange={(event) =>
              update(
                { reducedMotion: event.target.value as GameSettings["reducedMotion"] },
                `Reduce motion: ${event.target.value}.`,
              )
            }
            value={settings.reducedMotion}
          >
            <option value="system">Follow system setting</option>
            <option value="on">Always reduce</option>
            <option value="off">Full motion</option>
          </select>
        </div>
      </div>

      <p className="mt-8">
        <Link className={buttonStyle} href="/midnight-signal">
          Back to The Midnight Signal
        </Link>
      </p>
    </div>
  );
}
