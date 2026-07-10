export type MysteryClipPhase =
  | "idle"
  | "loading"
  | "playing"
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
  | { type: "playing" | "ended" | "failed"; attempt: number }
  | { type: "loading-announced" | "failure-announced"; attempt: number }
  | { type: "stop" }
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
  if (event.type === "reset" || event.type === "stop") {
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
  if (state.phase === "loading" || state.phase === "playing") return "Stop mystery clip";
  return "Play mystery clip";
}

export function mysteryClipStatusText(state: MysteryClipState): string {
  switch (state.phase) {
    case "loading":
      return "Loading mystery clip…";
    case "playing":
      return "Mystery clip playing.";
    case "ended":
      return "Mystery clip finished.";
    case "failed":
      return "Mystery clip unavailable. Use the text clue, or retry.";
    default:
      return "Mystery clip ready.";
  }
}
