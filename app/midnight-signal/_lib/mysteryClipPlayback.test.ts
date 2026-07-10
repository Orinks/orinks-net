import { describe, expect, test, vi } from "vitest";
import type { MysteryClipEvent } from "./mysteryClipMachine";
import { MysteryClipPlayback } from "./mysteryClipPlayback";

function harness() {
  const announcements: string[] = [];
  const events: MysteryClipEvent[] = [];
  const release = vi.fn();
  const beforePlay = vi.fn();
  const timers: Array<() => void> = [];
  const audio = {
    preload: "",
    currentTime: 9,
    onplaying: null as (() => void) | null,
    onended: null as (() => void) | null,
    onerror: null as (() => void) | null,
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
    load: vi.fn(),
    removeAttribute: vi.fn(),
  };
  const playback = new MysteryClipPlayback({
    announce: (message) => announcements.push(message),
    beforePlay,
    suppressMusic: () => release,
    onState: (event) => events.push(event),
    createAudio: () => audio,
    schedule: (callback) => {
      timers.push(callback);
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    },
    cancelSchedule: vi.fn(),
  });
  return { announcements, audio, beforePlay, events, playback, release, timers };
}

describe("mystery clip streaming lifecycle", () => {
  test("suppresses music and announces only confirmed playback", async () => {
    const { announcements, audio, beforePlay, events, playback, timers } = harness();
    playback.play("ms-clip-7f3a91c2");
    await Promise.resolve();

    expect(beforePlay).toHaveBeenCalledOnce();
    expect(audio.preload).toBe("metadata");
    expect(events[0]).toEqual({ type: "activate" });
    expect(announcements).toEqual([]);
    timers[0]();
    expect(announcements).toEqual(["Loading mystery clip."]);
    audio.onplaying?.();
    expect(announcements.at(-1)).toBe("Mystery clip playing.");
  });

  test("stops synchronously, resets media, releases suppression, and invalidates callbacks", () => {
    const { announcements, audio, events, playback, release } = harness();
    playback.play("ms-clip-b4e82d16");
    const stalePlaying = audio.onplaying;
    playback.stop();

    expect(playback.active).toBe(false);
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
    expect(audio.removeAttribute).toHaveBeenCalledWith("src");
    expect(audio.load).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(events.at(-1)).toEqual({ type: "stop" });
    expect(announcements).toEqual(["Mystery clip stopped."]);
    stalePlaying?.();
    expect(announcements).toEqual(["Mystery clip stopped."]);
  });

  test("reports natural completion and failure once while always restoring music", async () => {
    const ended = harness();
    ended.playback.play("ms-clip-29c7fd40");
    ended.audio.onended?.();
    expect(ended.announcements).toEqual(["Mystery clip finished."]);
    expect(ended.release).toHaveBeenCalledOnce();

    const failed = harness();
    failed.audio.play.mockRejectedValueOnce(new Error("unavailable"));
    failed.playback.play("ms-clip-e163ab75");
    await Promise.resolve();
    await Promise.resolve();
    failed.audio.onerror?.();
    expect(failed.announcements).toEqual([
      "Mystery clip unavailable. Use the text clue, or try again.",
    ]);
    expect(failed.release).toHaveBeenCalledOnce();
  });

  test("disposes silently during question or route cleanup", () => {
    const { announcements, playback, release } = harness();
    playback.play("ms-clip-5d90c4fe");
    playback.dispose();
    expect(announcements).toEqual([]);
    expect(release).toHaveBeenCalledOnce();
  });
});
