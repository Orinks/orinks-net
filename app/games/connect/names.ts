// Player names for games connected to orinks.net: the same 3 to 48
// characters and three letters convex/games.ts and moderation enforce.
export type PlayerNameError = { kind: "length" | "letters" | "blocked" | "taken"; message: string };

export const PLAYER_NAME_ERRORS: Record<PlayerNameError["kind"], PlayerNameError> = {
  length: { kind: "length", message: "Enter a player name of 3 to 48 characters." },
  letters: { kind: "letters", message: "Player names must include at least three letters." },
  blocked: { kind: "blocked", message: "That name isn't allowed. Choose a different name." },
  taken: { kind: "taken", message: "That player name is already taken. Choose a different name." },
};

export function validatePlayerName(trimmed: string): PlayerNameError | null {
  if (trimmed.length < 3 || trimmed.length > 48) return PLAYER_NAME_ERRORS.length;
  if ((trimmed.match(/\p{L}/gu) ?? []).length < 3) return PLAYER_NAME_ERRORS.letters;
  return null;
}
