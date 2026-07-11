import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { HostAudioPlayer, speakProducer, stopProducer } from "./audio";

describe("audio cancellation", () => {
  beforeEach(() => {
    const audioInstances: unknown[] = [];
    class FakeAudio {
      volume = 1;
      muted = false;
      src = "";
      paused = false;
      ended = false;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(src = "") {
        this.src = src;
        audioInstances.push(this);
      }
      play = vi.fn(async () => undefined);
      pause = vi.fn(() => {
        this.paused = true;
      });
      removeAttribute = vi.fn(() => {
        this.src = "";
      });
      load = vi.fn();
    }
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("__audioInstances", audioInstances);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("stopping Clyde synchronously settles the active playback promise", async () => {
    const player = new HostAudioPlayer(0.8);
    let settled = false;
    const playback = player.play("/audio/trivia/example.mp3").then(() => {
      settled = true;
    });

    player.stop();
    await playback;
    expect(settled).toBe(true);
  });

  test("reports failed playback so the caller can announce a text fallback", async () => {
    const player = new HostAudioPlayer(0.8);
    const playback = player.play("/audio/trivia/missing.mp3");
    const [audio] = (globalThis as unknown as {
      __audioInstances: Array<{ onerror: (() => void) | null }>;
    }).__audioInstances;
    audio.onerror?.();

    await expect(playback).resolves.toBe("failed");
  });

  test("reports unavailable replay when there is no previous clip", async () => {
    const player = new HostAudioPlayer(0.8);
    await expect(player.replayLast()).resolves.toBe("unavailable");
  });

  test("gesture unlock reuses the activated media element for later narration", async () => {
    const player = new HostAudioPlayer(0.8);
    player.unlock();
    await Promise.resolve();
    const playback = player.play("/audio/trivia/example.mp3");
    player.stop();
    await playback;
    expect(
      (globalThis as unknown as { __audioInstances: unknown[] })
        .__audioInstances,
    ).toHaveLength(1);
  });

  test("stopping the Producer synchronously settles the active speech promise", async () => {
    class FakeUtterance {
      volume = 1;
      rate = 1;
      pitch = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly text: string) {}
    }
    const speechSynthesis = {
      speak: vi.fn(),
      cancel: vi.fn(),
    };
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    vi.stubGlobal("window", { speechSynthesis });

    let settled = false;
    const speech = speakProducer("The signal is changing.").then(() => {
      settled = true;
    });
    stopProducer();
    await speech;

    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(1);
    expect(settled).toBe(true);
  });
});
