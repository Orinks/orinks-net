import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { HostAudioPlayer, speakProducer, stopProducer } from "./audio";

describe("audio cancellation", () => {
  beforeEach(() => {
    class FakeAudio {
      volume = 1;
      paused = false;
      ended = false;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly src: string) {}
      play = vi.fn(async () => undefined);
      pause = vi.fn(() => {
        this.paused = true;
      });
    }
    vi.stubGlobal("Audio", FakeAudio);
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
