"use client";

import { useEffect, useRef, useState } from "react";
import { MysteryClipPlayback } from "../_lib/mysteryClipPlayback";
import {
  initialMysteryClipState,
  mysteryClipButtonLabel,
  mysteryClipStatusText,
  reduceMysteryClipState,
} from "../_lib/mysteryClipMachine";

export interface ClientMysteryClip {
  id: string;
  startSeconds: number;
  durationSeconds: number;
  textClue: string;
}

interface MysteryClipPlayerProps {
  clip: ClientMysteryClip;
  answered: boolean;
  announce: (message: string) => void;
  beforePlay: () => void;
  suppressMusic: () => () => void;
  registerStop: (stop: (() => void) | null) => void;
  buttonClassName: string;
  volume: number;
}

export function MysteryClipPlayer({
  clip,
  answered,
  announce,
  beforePlay,
  suppressMusic,
  registerStop,
  buttonClassName,
  volume,
}: MysteryClipPlayerProps) {
  const [state, setState] = useState(initialMysteryClipState);
  const playback = useRef<MysteryClipPlayback | null>(null);

  if (!playback.current) {
    playback.current = new MysteryClipPlayback({
      announce,
      beforePlay,
      suppressMusic,
      onState: (event) =>
        setState((current) => reduceMysteryClipState(current, event)),
      volume,
    });
  }

  useEffect(() => {
    const controller = playback.current!;
    registerStop(() => controller.stop(false));
    return () => {
      registerStop(null);
      controller.dispose();
    };
  }, [registerStop]);

  useEffect(() => {
    if (answered) playback.current?.stop(false);
  }, [answered]);

  const activate = () => {
    if (state.phase === "loading") return;
    const controller = playback.current!;
    if (state.phase === "playing") controller.pause();
    else if (state.phase === "paused") controller.resume();
    else if (state.phase === "ended") controller.replay();
    else controller.play(clip.id, clip.startSeconds, clip.durationSeconds);
  };

  return (
    <div className="mt-4 rounded-md border border-amber-700 p-4">
      <p className="font-semibold text-amber-100">Equivalent text clue</p>
      <p className="mt-1 leading-7">{clip.textClue}</p>
      {!answered ? (
        <button
          aria-disabled={state.phase === "loading"}
          className={`${buttonClassName} mt-3`}
          onClick={activate}
          type="button"
        >
          {mysteryClipButtonLabel(state)}
        </button>
      ) : null}
      <p className="mt-2 text-sm leading-6 text-zinc-400">
        {answered
          ? "Mystery clip stopped for answer review."
          : mysteryClipStatusText(state)}
      </p>
    </div>
  );
}
