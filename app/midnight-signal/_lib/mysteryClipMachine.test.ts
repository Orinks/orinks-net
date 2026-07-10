import { describe, expect, test } from "vitest";
import {
  initialMysteryClipState,
  mysteryClipButtonLabel,
  reduceMysteryClipState,
} from "./mysteryClipMachine";

describe("mystery clip playback state", () => {
  test("follows confirmed media events through play, pause, resume, and replay", () => {
    let state = initialMysteryClipState;

    state = reduceMysteryClipState(state, { type: "activate" });
    expect(state).toMatchObject({ phase: "loading", attempt: 1 });
    expect(mysteryClipButtonLabel(state)).toBe("Play mystery clip");

    state = reduceMysteryClipState(state, { type: "playing", attempt: 1 });
    expect(mysteryClipButtonLabel(state)).toBe("Pause mystery clip");

    state = reduceMysteryClipState(state, { type: "paused", attempt: 1 });
    expect(state.phase).toBe("paused");
    expect(mysteryClipButtonLabel(state)).toBe("Play mystery clip");

    state = reduceMysteryClipState(state, { type: "activate" });
    expect(state.attempt).toBe(2);
    state = reduceMysteryClipState(state, { type: "playing", attempt: 2 });
    state = reduceMysteryClipState(state, { type: "ended", attempt: 2 });
    expect(mysteryClipButtonLabel(state)).toBe("Replay mystery clip");

    state = reduceMysteryClipState(state, { type: "activate" });
    expect(state).toMatchObject({ phase: "loading", attempt: 3 });
  });

  test("offers Retry only after a terminal playback failure", () => {
    let state = reduceMysteryClipState(initialMysteryClipState, { type: "activate" });
    state = reduceMysteryClipState(state, { type: "failed", attempt: 1 });

    expect(state.phase).toBe("failed");
    expect(mysteryClipButtonLabel(state)).toBe("Retry mystery clip");
  });

  test("ignores stale callbacks after reset or a newer attempt", () => {
    let state = reduceMysteryClipState(initialMysteryClipState, { type: "activate" });
    state = reduceMysteryClipState(state, { type: "reset" });
    expect(state).toMatchObject({ phase: "idle", attempt: 2 });

    expect(reduceMysteryClipState(state, { type: "playing", attempt: 1 })).toBe(state);
    state = reduceMysteryClipState(state, { type: "activate" });
    expect(reduceMysteryClipState(state, { type: "failed", attempt: 2 })).toBe(state);
  });

  test("deduplicates delayed loading and failure announcement markers per attempt", () => {
    let state = reduceMysteryClipState(initialMysteryClipState, { type: "activate" });
    state = reduceMysteryClipState(state, { type: "loading-announced", attempt: 1 });
    const afterLoading = state;
    state = reduceMysteryClipState(state, { type: "loading-announced", attempt: 1 });
    expect(state).toBe(afterLoading);

    state = reduceMysteryClipState(state, { type: "failed", attempt: 1 });
    state = reduceMysteryClipState(state, { type: "failure-announced", attempt: 1 });
    const afterFailure = state;
    state = reduceMysteryClipState(state, { type: "failure-announced", attempt: 1 });
    expect(state).toBe(afterFailure);
  });
});
