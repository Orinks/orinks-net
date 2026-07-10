export type MysteryClipPhase =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "ended"
  | "failed";

export interface MysteryClipState {
  phase: MysteryClipPhase;
  attempt: number;
  loadingAnnounced: boolean;
  failureAnnounced: boolean;
}

export type MysteryClipEvent =
  | { type: "activate" }
  | { type: "playing" | "paused" | "ended" | "failed"; attempt: number }
  | { type: "loading-announced" | "failure-announced"; attempt: number }
  | { type: "reset" };

export const initialMysteryClipState: MysteryClipState = {
  phase: "idle",
  attempt: 0,
  loadingAnnounced: false,
  failureAnnounced: false,
};

export function reduceMysteryClipState(
  state: MysteryClipState,
  event: MysteryClipEvent,
): MysteryClipState {
  if (event.type === "reset") {
    return { ...initialMysteryClipState, attempt: state.attempt + 1 };
  }
  if (event.type === "activate") {
    if (state.phase === "loading" || state.phase === "playing") return state;
    return {
      phase: "loading",
      attempt: state.attempt + 1,
      loadingAnnounced: false,
      failureAnnounced: false,
    };
  }
  if (event.attempt !== state.attempt) return state;

  if (event.type === "playing") {
    if (state.phase !== "loading") return state;
    return { ...state, phase: "playing" };
  }
  if (event.type === "paused") {
    if (state.phase !== "playing") return state;
    return { ...state, phase: "paused" };
  }
  if (event.type === "ended") {
    if (state.phase !== "playing" && state.phase !== "loading") return state;
    return { ...state, phase: "ended" };
  }
  if (event.type === "failed") {
    if (state.phase === "idle" || state.phase === "ended") return state;
    return { ...state, phase: "failed", failureAnnounced: false };
  }
  if (event.type === "loading-announced") {
    if (state.phase !== "loading" || state.loadingAnnounced) return state;
    return { ...state, loadingAnnounced: true };
  }
  if (state.phase !== "failed" || state.failureAnnounced) return state;
  return { ...state, failureAnnounced: true };
}

export function mysteryClipButtonLabel(state: MysteryClipState): string {
  if (state.phase === "playing") return "Pause mystery clip";
  if (state.phase === "ended") return "Replay mystery clip";
  if (state.phase === "failed") return "Retry mystery clip";
  return "Play mystery clip";
}

export function mysteryClipStatusText(state: MysteryClipState): string {
  switch (state.phase) {
    case "loading":
      return "Loading mystery clip…";
    case "playing":
      return "Mystery clip playing.";
    case "paused":
      return "Mystery clip paused.";
    case "ended":
      return "Mystery clip finished.";
    case "failed":
      return "Mystery clip unavailable. Use the text clue, or retry.";
    default:
      return "Mystery clip ready.";
  }
}
