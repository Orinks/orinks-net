"use client";

import { useAction } from "convex/react";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { ReviewStation } from "@/convex/freightFateStations";
import type { StationCheck } from "@/convex/freightFateStationVetting";

// One station's fixes on the review page: a new stream address, checked at
// once, or turning an AM or FM suggestion into web radio. Only one station's
// form is open at a time, so "Stream address" is never ambiguous.

export type FixOutcome =
  | { kind: "address"; station: ReviewStation; check: StationCheck }
  | { kind: "web"; station: ReviewStation }
  | { kind: "expired" };

const small =
  "rounded-md border border-line-strong px-3 py-1 text-sm font-semibold text-ink hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2 aria-disabled:cursor-not-allowed aria-disabled:bg-slate-500 aria-disabled:text-white";

export function StationFix({
  token,
  station,
  label,
  open,
  onToggle,
  onDone,
  onSlow,
}: {
  token: string;
  station: ReviewStation;
  label: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  /** Says what changed; true keeps the form open (a new address that did not play). */
  onDone: (outcome: FixOutcome) => boolean | void;
  /** A save still waiting on its stream check after a moment. */
  onSlow: () => void;
}) {
  const changeStream = useAction(api.freightFateStationVetting.changeStationStream);
  const makeWeb = useAction(api.freightFateStations.makeStationWebFromReview);
  const [address, setAddress] = useState(station.streamUrl);
  const [working, setWorking] = useState<"address" | "web" | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const editRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);
  const baseId = useId();

  useEffect(() => {
    if (open && !wasOpen.current) {
      setAddress(station.streamUrl);
      setError("");
      inputRef.current?.focus();
      // Selected, so a paste replaces the address that is there.
      inputRef.current?.select();
    } else if (!open && wasOpen.current) {
      // Only when focus was in this form or fell to the page as it closed:
      // opening another station's form closes this one, and keeps its focus.
      const active = document.activeElement;
      if (!active || active === document.body || boxRef.current?.contains(active)) editRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open, station.streamUrl]);

  function refuse(problem: string) {
    setError(problem);
    setAttempt((count) => count + 1);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (working) return;
    if (!address.trim()) return refuse("Enter a stream address.");
    setWorking("address");
    setError("");
    // The check can take up to 20 seconds; say so once if it is slow.
    const slow = setTimeout(onSlow, 2000);
    try {
      const result = await changeStream({ token, id: station.id, streamUrl: address });
      if ("expired" in result) return void onDone({ kind: "expired" });
      if (!result.ok) return refuse(result.problem);
      const keepOpen = onDone({ kind: "address", station: result.station, check: result.check });
      if (keepOpen) {
        // Saved, but it did not play: the reason sits with the address.
        refuse(result.check.text);
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    } catch {
      refuse("That did not go through. Try again.");
    } finally {
      clearTimeout(slow);
      setWorking(null);
    }
  }

  async function web() {
    if (working) return;
    setWorking("web");
    setError("");
    try {
      const result = await makeWeb({ token, id: station.id });
      if ("expired" in result) return void onDone({ kind: "expired" });
      if (!result.ok) return refuse(result.problem);
      onDone({ kind: "web", station: result.station });
    } catch {
      refuse("That did not go through. Try again.");
    } finally {
      setWorking(null);
    }
  }

  const inputId = `${baseId}-address`;
  const errorId = `${baseId}-error`;
  return (
    <div className="mt-2" ref={boxRef}>
      <button aria-expanded={open} className={small} onClick={() => onToggle(!open)} ref={editRef} type="button">
        Edit<span className="sr-only">{` ${label}`}</span>
      </button>
      {open ? (
        <form
          className="mt-3 space-y-3"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !working) {
              event.preventDefault();
              onToggle(false);
            }
          }}
          onSubmit={save}
        >
          <div>
            <label className="block font-semibold text-ink" htmlFor={inputId}>
              Stream address
            </label>
            <input
              aria-describedby={error ? errorId : undefined}
              aria-invalid={error ? true : undefined}
              className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-ink focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2"
              id={inputId}
              inputMode="url"
              onChange={(event) => {
                setAddress(event.target.value);
                setError("");
              }}
              ref={inputRef}
              type="text"
              value={address}
            />
          </div>
          <p className="font-semibold text-red-900" id={errorId} role="alert">
            {error ? <span key={attempt}>{error}</span> : null}
          </p>
          <div className="flex flex-wrap gap-3">
            <button aria-disabled={working !== null || undefined} className={small} type="submit">
              {working === "address" ? "Saving…" : "Save address"}
            </button>
            {station.kind === "terrestrial" ? (
              <button aria-disabled={working !== null || undefined} className={small} onClick={web} type="button">
                {working === "web" ? "Making web radio…" : "Make web radio"}
              </button>
            ) : null}
            <button className={small} onClick={() => !working && onToggle(false)} type="button">
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
