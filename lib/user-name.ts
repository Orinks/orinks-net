/** Minimal shape shared by Clerk's client user resources. */
type NamedUser = {
  username?: string | null;
  fullName?: string | null;
  firstName?: string | null;
};

/**
 * First non-empty display name for a signed-in user.
 *
 * Clerk returns empty STRINGS (not null) for unset names — e.g. fullName is
 * "" for an email-code signup with no name — and `??` chains sail right past
 * them, which once left a screen reader announcing "signed in as" followed
 * by nothing. Filter on trimmed truthiness instead.
 */
export function userDisplayName(user: NamedUser | null | undefined, fallback: string): string {
  for (const candidate of [user?.username, user?.fullName, user?.firstName]) {
    const trimmed = candidate?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return fallback;
}
