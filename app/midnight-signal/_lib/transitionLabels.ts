import type { GameEvent } from "../_components/gameTypes";

export function orderedTransitionLabel(events: GameEvent[], tapeIds: Iterable<string>) {
  const availableTapes = new Set(tapeIds);
  const next = events.find((event) => {
    if (event.type === "tapeUnlocked") return availableTapes.has(event.id);
    return ["finaleReady", "gameOver", "bankExhausted"].includes(event.type);
  });
  if (next?.type === "tapeUnlocked") return "Open recovered tape";
  if (next?.type === "finaleReady") return "Continue to Channel 100";
  if (next?.type === "gameOver" || next?.type === "bankExhausted") return "Show final results";
  return null;
}
