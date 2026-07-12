export function freightFateEventFragment(eventId: string) {
  return `event-${Buffer.from(eventId, "utf8").toString("base64url")}`;
}
