"use client";

import "ableplayer/build/ableplayer.min.css";
import { useEffect, useRef, useState } from "react";

type Song = { slug: string; title: string; src: string };
// The prototype methods we adjust aren't in Able Player's published types.
type Able = any;

const PLAYER_ID = "grimatonics-player";
const AUTO_KEY = "grimatonics-auto-advance";

// Read by onMediaComplete below; the checkbox keeps it current.
let autoAdvance = false;
let patched = false;

// Changes to Able Player itself, made once for every player on the page.
function patchAblePlayer(proto: Able) {
  if (patched) return;
  patched = true;

  // Nothing plays until someone presses Play or picks a song. Left alone, the
  // first song starts by itself when it loads before setup finishes.
  const loaded = proto.onMediaNewSourceLoad;
  proto.onMediaNewSourceLoad = function (this: Able) {
    if (!this.startedPlaying && !this.userClickedPlaylist) this.swappingSrc = false;
    return loaded.call(this);
  };

  // "Selected Track" is silent while the page loads, then announced politely
  // (not over whatever the screen reader was saying) when the song changes.
  const inject = proto.injectPlayerControlArea;
  proto.injectPlayerControlArea = function (this: Able) {
    inject.call(this);
    this.$nowPlayingDiv?.removeAttr("aria-live");
  };

  // A song ending only moves on to the next one when the listener asked for
  // it, and never under an open settings dialog: changing songs deletes the
  // dialog and strands its overlay over the page.
  const complete = proto.onMediaComplete;
  proto.onMediaComplete = function (this: Able) {
    if (autoAdvance && !document.body.classList.contains("able-modal-active")) return complete.call(this);
    this.refreshControls();
  };

  // The timeline's arrow keys move one second a press; make it ten. Page Up
  // and Page Down pass the seek interval through untouched.
  const seekbar = proto.addSeekbarListeners;
  proto.addSeekbarListeners = function (this: Able) {
    const slider = this.seekBar && Object.getPrototypeOf(this.seekBar);
    if (slider && !slider.tenSeconds) {
      slider.tenSeconds = true;
      const arrow = slider.arrowKeyDown;
      slider.arrowKeyDown = function (this: Able, step: number) {
        return arrow.call(this, Math.abs(step) === 1 ? step * 10 : step);
      };
    }
    return seekbar.call(this);
  };

  // Mark while the controls are being rebuilt.
  const recreate = proto.recreatePlayer;
  proto.recreatePlayer = function (this: Able) {
    const done = recreate.call(this);
    if (done) {
      this.rebuilding = true;
      done.then(() => (this.rebuilding = false));
    }
    return done;
  };

  const cue = proto.cuePlaylistItem;
  proto.cuePlaylistItem = function (this: Able, index: number) {
    // Able deletes the controls before checking whether it is already
    // rebuilding them, so a second change mid-rebuild left the player with no
    // controls at all. Ignore it instead. Once rebuilt, Able's own flag stays
    // set until a song can play through, which with preload="metadata" may be
    // never, and then even the first song picked would delete the controls.
    if (this.rebuilding) return;
    this.recreatingPlayer = false;
    if (!this.initializing) this.$nowPlayingDiv?.attr("aria-live", "polite");
    // Able puts focus back on Next or Previous itself. If focus was on any
    // other control, it is lost to the page; put it on Play/Pause.
    if (this.$ableWrapper?.[0]?.contains(document.activeElement)) {
      this.recreatePlayer = function (this: Able) {
        const done = proto.recreatePlayer.call(this);
        done?.then(() => {
          if (document.activeElement === document.body) this.$ableWrapper.find(".able-button-handler-play").trigger("focus");
        });
        return done;
      };
    }
    try {
      return cue.call(this, index);
    } finally {
      delete this.recreatePlayer;
    }
  };
}

export function GrimatonicsPlayer({ songs }: { songs: Song[] }) {
  const listRef = useRef<HTMLOListElement>(null);
  const playerRef = useRef<Able>(null);
  const [current, setCurrent] = useState(0);
  const [auto, setAuto] = useState(false);

  useEffect(() => {
    try {
      setAuto(localStorage.getItem(AUTO_KEY) === "true");
    } catch {}
  }, []);

  useEffect(() => {
    autoAdvance = auto;
  }, [auto]);

  useEffect(() => {
    let gone = false;
    const list = listRef.current!;
    const observer = new MutationObserver(() => {
      const index = [...list.querySelectorAll("button")].findIndex((b) => b.getAttribute("aria-current"));
      if (index >= 0) setCurrent(index);
    });
    observer.observe(list, { subtree: true, attributeFilter: ["aria-current"] });

    (async () => {
      const [{ default: AblePlayer }, { default: $ }] = await Promise.all([
        import("ableplayer"),
        import("jquery"),
      ]);
      if (gone) return;
      patchAblePlayer(AblePlayer.prototype);
      playerRef.current = new AblePlayer($(`#${PLAYER_ID}`));
    })();

    return () => {
      gone = true;
      observer.disconnect();
      const player = playerRef.current;
      playerRef.current = null;
      if (!player) return;
      player.media?.pause();
      player.dispose();
      // An open settings dialog makes the rest of the page inert; dispose()
      // removes the dialog but not that, which would freeze the next page.
      document.body.classList.remove("able-modal-active");
      document.querySelectorAll("body > [inert]").forEach((el) => el.removeAttribute("inert"));
      // Able Player listens on the whole page; without these the old player
      // would keep answering after you leave.
      import("jquery").then(({ default: $ }) => {
        $(document).off("keydown mousemove touchmove fullscreenchange webkitfullscreenchange");
        $(window).off("resize");
      });
    };
  }, []);

  const song = songs[current];

  return (
    <div className="space-y-4">
      <p className="leading-7 text-slate-700">
        Tab to the timeline, the first control in the player. Your screen reader switches to focus mode
        there, and plain keys work: Left and Right go back and forward 10 seconds, Page Up and Page Down 30
        seconds, Home and End go to the start and end, and Space plays or pauses. If you reach it by
        reading instead, turn on focus mode yourself (NVDA+Space).
      </p>
      {/* A wrapper React owns: Able Player rebuilds everything inside it.
          Space on the timeline plays or pauses; held down, it toggles once. */}
      <div
        onKeyDown={(e) => {
          if (e.key !== " " || !(e.target as Element).closest(".able-seekbar-head")) return;
          e.preventDefault();
          if (!e.repeat) playerRef.current?.handlePlay();
        }}
      >
        <audio
          data-heading-level="0"
          data-seek-interval="30"
          data-show-now-playing="true"
          data-skin="2020"
          id={PLAYER_ID}
          preload="metadata"
        />
      </div>
      <label className="flex items-center gap-3 font-semibold text-ink">
        <input
          checked={auto}
          className="h-5 w-5"
          onChange={(e) => {
            setAuto(e.target.checked);
            try {
              localStorage.setItem(AUTO_KEY, String(e.target.checked));
            } catch {}
          }}
          type="checkbox"
        />
        Play the next song automatically when one ends
      </label>
      <ol className="able-playlist grimatonics-playlist" data-player={PLAYER_ID} ref={listRef} role="list">
        {songs.map((s) => (
          <li key={s.slug}>
            {/* Able Player reads "Selected Track:" straight onto this text,
                so it starts with a space. */}{" "}
            <span className="able-source" data-src={s.src} data-type="audio/mpeg" />
            <button type="button">{s.title}</button>
          </li>
        ))}
      </ol>
      <p>
        <a className="font-semibold text-action underline hover:text-action-dark" href={`#${song.slug}`}>
          Notes for {song.title}
        </a>
      </p>
    </div>
  );
}
