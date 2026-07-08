"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { fetchManifest, HostAudioPlayer, type AudioManifest } from "../_lib/audio";
import { getPlayerKey, loadSettings } from "../_lib/settings";

const focusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";
const buttonStyle = `inline-flex min-h-10 items-center justify-center rounded-md border border-amber-700 px-4 py-2 font-semibold text-amber-100 hover:bg-zinc-900 ${focusRing}`;

export function TapeArchive() {
  const [playerKey, setPlayerKey] = useState("");
  const [manifest, setManifest] = useState<AudioManifest | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const playerRef = useRef<HostAudioPlayer | null>(null);

  useEffect(() => {
    setPlayerKey(getPlayerKey());
    playerRef.current = new HostAudioPlayer(loadSettings().hostVolume);
    fetchManifest().then(setManifest);
    return () => playerRef.current?.stop();
  }, []);

  const story = useQuery(api.trivia.getStory, playerKey ? { playerKey } : "skip");

  const playTape = async (tapeId: string, audioPath: string) => {
    if (playingId === tapeId) {
      playerRef.current?.stop();
      setPlayingId(null);
      return;
    }
    setPlayingId(tapeId);
    await playerRef.current?.play(audioPath);
    setPlayingId((current) => (current === tapeId ? null : current));
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-bold text-amber-200">Tape Archive</h1>
      <p className="mt-3 leading-7">
        Master tapes recovered from the studio archive. Complete rounds during a broadcast to
        find more. Every tape includes its full transcript.
      </p>
      {story === undefined ? (
        <p className="mt-6">Checking the archive…</p>
      ) : (
        <ul className="mt-6 space-y-6">
          {Array.from({ length: story.tapesTotal }, (_, index) => {
            const tape = story.tapes.find((t) => t.order === index + 1);
            if (!tape) {
              return (
                <li className="rounded-lg border border-zinc-700 p-4" key={`locked-${index + 1}`}>
                  <h2 className="text-lg font-semibold text-zinc-400">
                    <span aria-hidden="true">Tape {index + 1}: ???</span>
                    <span className="sr-only">Tape {index + 1}: locked</span>
                  </h2>
                  <p className="mt-1 text-sm text-zinc-400">Not yet recovered.</p>
                </li>
              );
            }
            const audioPath = manifest?.story[tape.id];
            return (
              <li className="rounded-lg border border-amber-700 p-4" key={tape.id}>
                <h2 className="text-lg font-semibold text-amber-100">
                  Tape {tape.order}: {tape.title}
                </h2>
                {audioPath ? (
                  <button
                    className={`${buttonStyle} mt-2`}
                    onClick={() => void playTape(tape.id, audioPath)}
                    type="button"
                  >
                    {playingId === tape.id ? `Stop tape ${tape.order}` : `Play tape ${tape.order}: ${tape.title}`}
                  </button>
                ) : null}
                <p className="mt-3 leading-7">{tape.text}</p>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-8">
        <Link className={buttonStyle} href="/midnight-signal">
          Back to The Midnight Signal
        </Link>
      </p>
    </div>
  );
}
