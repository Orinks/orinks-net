"use client";

import { useAction } from "convex/react";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { ReviewStation } from "@/convex/freightFateStations";
import {
  stationLabel,
  usePreview,
} from "../suggest-a-station/station-list-picker";

// The owner's review of suggested stations, opened from the daily digest's
// one link: tick stations, listen to any of them, then accept or decline the
// ticked ones together. What is left unticked keeps waiting.

type Decision = "accepted" | "declined";

const plural = (count: number) =>
  `${count} ${count === 1 ? "station" : "stations"}`;

const button =
  "rounded-md px-5 py-3 font-semibold focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2 aria-disabled:cursor-not-allowed aria-disabled:bg-slate-500 aria-disabled:text-white";

export function StationReviewClient({ token }: { token: string }) {
  const load = useAction(api.freightFateStations.reviewStationBatch);
  const decideBatch = useAction(api.freightFateStations.decideStationBatch);
  const [stations, setStations] = useState<ReviewStation[] | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "expired" | "failed"
  >("loading");
  const [picked, setPicked] = useState<string[]>([]);
  const [working, setWorking] = useState<Decision | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // Bumped on every refusal, so pressing again re-announces the same error.
  const [attempt, setAttempt] = useState(0);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const expiredRef = useRef<HTMLHeadingElement>(null);
  const loadedRef = useRef(false);
  const baseId = useId();
  const preview = usePreview();

  useEffect(() => {
    let live = true;
    load({ token })
      .then((result) => {
        if (!live) return;
        loadedRef.current = true;
        if (result.ok) {
          setStations(result.stations);
          setState("ready");
        } else {
          setState("expired");
        }
      })
      .catch(() => live && setState("failed"));
    return () => {
      live = false;
    };
  }, [load, token]);

  const empty = state === "ready" && stations?.length === 0;
  useEffect(() => {
    if (empty && message) doneRef.current?.focus();
  }, [empty, message]);
  // A link that expires mid-review takes the buttons away; land on why.
  useEffect(() => {
    if (state === "expired" && loadedRef.current) expiredRef.current?.focus();
  }, [state]);

  async function decide(decision: Decision) {
    if (working || !stations) return;
    if (picked.length === 0) {
      setError("Choose at least one station.");
      setAttempt((count) => count + 1);
      return;
    }
    setError("");
    setMessage("");
    setWorking(decision);
    preview.stop();
    try {
      const result = await decideBatch({
        token,
        ids: picked as ReviewStation["id"][],
        decision,
      });
      if (!result.ok) {
        setState("expired");
        return;
      }
      const decided = new Set<string>(result.decided);
      const verb = decision === "accepted" ? "Accepted" : "Declined";
      const skipped = picked.length - decided.size;
      setMessage(
        `${verb} ${plural(decided.size)}.` +
          (skipped > 0 ? ` ${plural(skipped)} had already been decided.` : ""),
      );
      setStations(stations.filter((station) => !picked.includes(station.id)));
      setPicked([]);
    } catch {
      setError("That did not go through. Try again.");
      setAttempt((count) => count + 1);
    } finally {
      setWorking(null);
    }
  }

  if (state === "loading") return <p role="status">Loading the suggestions…</p>;
  if (state === "failed") {
    return (
      <p className="max-w-2xl text-slate-700">
        The suggestions could not be loaded. Reload the page to try again.
      </p>
    );
  }
  if (state === "expired") {
    return (
      <div className="max-w-2xl space-y-3">
        <h2
          className="text-2xl font-bold text-ink focus:outline-none focus:ring-4 focus:ring-sky-600"
          ref={expiredRef}
          tabIndex={-1}
        >
          This review link does not work
        </h2>
        <p className="text-slate-700">
          It has expired, or it was changed. The next station digest carries a
          fresh one.
        </p>
      </div>
    );
  }
  if (!stations || stations.length === 0) {
    return (
      <div className="max-w-2xl space-y-3">
        <h2
          aria-describedby={message ? `${baseId}-result` : undefined}
          className="text-2xl font-bold text-ink focus:outline-none focus:ring-4 focus:ring-sky-600"
          ref={doneRef}
          tabIndex={-1}
        >
          Nothing is waiting for review
        </h2>
        {message ? (
          <p className="text-slate-700" id={`${baseId}-result`}>
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  const all = picked.length === stations.length;
  const errorId = `${baseId}-error`;
  const checkboxId = (index: number) => `${baseId}-station-${index}`;

  return (
    <div className="max-w-3xl">
      <p
        className={message ? "mb-6 font-semibold text-ink" : "sr-only"}
        role="status"
      >
        {message}
      </p>
      <fieldset className="rounded-lg border border-line-strong p-5">
        <legend className="px-1">
          <h2 className="text-xl font-bold text-ink">
            {plural(stations.length)} waiting
          </h2>
        </legend>
        {stations.length > 1 ? (
          <button
            className="mt-2 rounded-md border border-line-strong px-4 py-2 font-semibold text-ink hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2"
            onClick={() => {
              setPicked(all ? [] : stations.map((station) => station.id));
              setError("");
            }}
            type="button"
          >
            {all ? "Clear all" : "Select all"}
          </button>
        ) : null}
        <ul className="mt-4 space-y-5">
          {stations.map((station, index) => {
            const on = picked.includes(station.id);
            const label = stationLabel(station);
            const playing = preview.playing === index;
            return (
              <li key={station.id}>
                <div className="flex flex-wrap items-center gap-3">
                  {/* A heading per station, so H moves through a long list one station at a time. */}
                  <h3 className="flex min-w-0 flex-1">
                    <label
                      className="flex min-w-0 flex-1 items-center gap-3 font-semibold text-ink"
                      htmlFor={checkboxId(index)}
                    >
                      <input
                        checked={on}
                        className="h-5 w-5 shrink-0 focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2"
                        id={checkboxId(index)}
                        onChange={() => {
                          setPicked(
                            on
                              ? picked.filter((id) => id !== station.id)
                              : [...picked, station.id],
                          );
                          setError("");
                        }}
                        type="checkbox"
                      />
                      <span className="break-all">{label}</span>
                    </label>
                  </h3>
                  <button
                    className="rounded-md border border-line-strong px-3 py-1 text-sm font-semibold text-ink hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2"
                    onClick={() =>
                      playing ? preview.stop() : preview.play(index, station)
                    }
                    type="button"
                  >
                    {playing ? "Stop" : "Preview"}
                    <span className="sr-only"> {label}</span>
                  </button>
                </div>
                <div className="mt-1 pl-8 text-sm text-slate-700">
                  {/* A station with no name is labelled by its address already. */}
                  {station.facts
                    .filter(([term]) => station.name || term !== "Stream")
                    .map(([term, value]) => (
                      <p className="break-all" key={term}>
                        {term}: {value}
                      </p>
                    ))}
                </div>
              </li>
            );
          })}
        </ul>
        <p aria-live="polite" className="sr-only">
          {preview.failed}
        </p>
      </fieldset>
      <div className="mt-6 flex flex-wrap gap-4">
        <button
          aria-describedby={error ? errorId : undefined}
          aria-disabled={working !== null || undefined}
          className={`${button} bg-action text-white hover:bg-action-dark`}
          onClick={() => decide("accepted")}
          type="button"
        >
          {working === "accepted"
            ? "Accepting…"
            : picked.length > 0
              ? `Accept ${plural(picked.length)}`
              : "Accept"}
        </button>
        <button
          aria-describedby={error ? errorId : undefined}
          aria-disabled={working !== null || undefined}
          className={`${button} border-2 border-red-800 bg-white text-red-900 hover:bg-red-50`}
          onClick={() => decide("declined")}
          type="button"
        >
          {working === "declined"
            ? "Declining…"
            : picked.length > 0
              ? `Decline ${plural(picked.length)}`
              : "Decline"}
        </button>
      </div>
      <p className="mt-3 font-semibold text-red-900" id={errorId} role="alert">
        {error ? (
          <span key={attempt}>
            <span className="sr-only">Error: </span>
            {error}
          </span>
        ) : null}
      </p>
    </div>
  );
}
