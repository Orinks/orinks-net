"use client";

import { useEffect, useRef, useState } from "react";
import type { ListedStation } from "@/convex/freightFateStationRules";

// The picker shown when a suggested address turns out to be a playlist of
// several stations: one checkbox per station, as many as today's allowance
// lets through, and a short listen to each before choosing.

const PREVIEW_MS = 25_000;

/** What a checkbox and a result line call a station: its title, or its address. */
export function stationLabel(station: ListedStation) {
  return station.name || station.streamUrl;
}

export function StationListPicker({
  checkboxId,
  error,
  headingRef,
  limit,
  onChange,
  picked,
  stations,
}: {
  /** The id of station i's checkbox, so the error summary can link the first. */
  checkboxId: (index: number) => string;
  /** "Choose at least one station." after a send with none ticked. */
  error?: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  limit: number;
  onChange: (picked: number[]) => void;
  picked: number[];
  stations: ListedStation[];
}) {
  const full = picked.length >= limit;
  const left = limit - picked.length;
  const leftText = left === 0 ? "None left" : `${left} left`;
  // Said only when a box changes the count: the heading already gave the start.
  const [announcement, setAnnouncement] = useState("");
  const preview = usePreview();
  const errorId = error ? `${checkboxId(0)}-error` : undefined;

  function toggle(index: number) {
    const on = picked.includes(index);
    // aria-disabled keeps the box reachable. The box is controlled, so leaving
    // the picks alone puts its tick back; nothing is said, it is unavailable.
    if (!on && full) return;
    const next = on ? picked.filter((value) => value !== index) : [...picked, index];
    onChange(next);
    const remaining = limit - next.length;
    setAnnouncement(remaining === 0 ? "None left" : `${remaining} left`);
  }

  return (
    <fieldset aria-describedby={errorId} className="rounded-lg border border-line-strong p-5">
      <legend className="px-1">
        <h2 className="text-xl font-bold text-ink focus:outline-none focus:ring-4 focus:ring-sky-600" ref={headingRef} tabIndex={-1}>
          Choose up to {limit} of {stations.length} stations
        </h2>
      </legend>
      <p aria-hidden="true" className="mt-2 font-semibold text-ink">
        {leftText}
      </p>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {limit >= stations.length && stations.length > 1 ? (
        <button
          className="mt-4 rounded-md border border-line-strong px-4 py-2 font-semibold text-ink hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2"
          onClick={() => {
            onChange(stations.map((_, index) => index));
            setAnnouncement("None left");
          }}
          type="button"
        >
          Select all
        </button>
      ) : null}
      <ul className="mt-4 space-y-3">
        {stations.map((station, index) => {
          const on = picked.includes(index);
          const unavailable = !on && full;
          const label = stationLabel(station);
          const playing = preview.playing === index;
          return (
            <li className="flex flex-wrap items-center gap-3" key={`${index}-${station.streamUrl}`}>
              <label className={`flex min-w-0 flex-1 items-center gap-3 ${unavailable ? "text-slate-500" : "text-ink"}`}>
                <input
                  aria-describedby={errorId}
                  aria-disabled={unavailable || undefined}
                  checked={on}
                  className="h-5 w-5 shrink-0 focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2"
                  id={checkboxId(index)}
                  onChange={() => toggle(index)}
                  type="checkbox"
                />
                <span className="break-all">{label}</span>
              </label>
              <button
                className="rounded-md border border-line-strong px-3 py-1 text-sm font-semibold text-ink hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2"
                onClick={() => (playing ? preview.stop() : preview.play(index, station))}
                type="button"
              >
                {playing ? "Stop" : "Preview"}
                <span className="sr-only"> {label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className="mt-2 font-semibold text-red-900" id={errorId}>
          <span className="sr-only">Error: </span>
          {error}
        </p>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {preview.failed}
      </p>
    </fieldset>
  );
}

/** One station playing at a time, through the site, for twenty-five seconds. */
export function usePreview() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [failed, setFailed] = useState("");

  function stop() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
    audioRef.current = null;
    setPlaying(null);
  }

  function play(index: number, station: ListedStation) {
    stop();
    setFailed("");
    const audio = new Audio(`/api/freight-fate/stations/preview?url=${encodeURIComponent(station.streamUrl)}`);
    audioRef.current = audio;
    const failure = () => {
      if (audioRef.current !== audio) return;
      stop();
      setFailed(`${stationLabel(station)} didn't play.`);
    };
    audio.addEventListener("error", failure);
    audio.addEventListener("ended", () => {
      if (audioRef.current === audio) stop();
    });
    audio.play().catch(failure);
    setPlaying(index);
    timerRef.current = setTimeout(() => {
      if (audioRef.current === audio) stop();
    }, PREVIEW_MS);
  }

  // Nothing keeps playing once the picker is gone.
  useEffect(() => () => stop(), []);

  return { playing, failed, play, stop };
}
