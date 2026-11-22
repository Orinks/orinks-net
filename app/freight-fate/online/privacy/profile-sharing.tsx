/**
 * The Profile sharing paragraphs. Until the driver newspaper is announced
 * (lib/freight-fate-paper-launch.ts) they are the wording from before it.
 */
export function ProfileSharing({ announced }: { announced: boolean }) {
  if (!announced) {
    return <>
      <p>Publishes your driver name, current verified career and resume, account-wide achievements, board status, and road-journal posts on orinks.net. Turning Profile sharing off removes them from public pages. Previously received data may remain stored and can reappear if you turn sharing on again.</p>
      <p>Meaningful play selects your current career. Accepting a job, starting a drive, completing a delivery, or changing equipment or business status marks that career as current. Browsing, opening, or loading a career does not switch it.</p>
      <p>Current cash, available credit, precise location, exact cargo, customer, cargo value, destination, fatigue, exact hours-of-service state, and dispatcher standing remain private.</p>
    </>;
  }
  return <>
      <p>Publishes your driver name, current verified career and resume, account-wide achievements, board status, and road-journal posts on orinks.net. The weekly driver newspaper on orinks.net can write about your career, including the cargo type and the cities of deliveries you finished. Turning Profile sharing off removes all of this from public pages, the newspaper&apos;s past issues included. Previously received data may remain stored and can reappear if you turn sharing on again.</p>
      <p>Meaningful play selects your current career. Accepting a job, starting a drive, completing a delivery, or changing equipment or business status marks that career as current. Browsing, opening, or loading a career does not switch it.</p>
      <p>Current cash, available credit, precise location, the cargo and destination of a load you are still hauling, customer, cargo value, fatigue, exact hours-of-service state, and dispatcher standing remain private.</p>
  </>;
}
