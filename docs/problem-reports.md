# Problem reports from the games

`POST /api/problem-reports` takes a problem report from a Hearken game and
emails it to the inbox the contact form uses, with the game's logs as text
attachments. The game side is Hearken's `report` feature (`docs/reports.md`
in orinks-games/hearken); the format is mailbag's, so a `mailbag-server`
would take the same reports.

What the route does, in order:

1. Refuses a client address in `PROBLEM_REPORT_BLOCK` (403).
2. Unpacks the body when it is gzipped, within 6 MB (413), and parses the
   report against the limits the game checks too (400, 413).
3. Takes only the games named in `lib/problem-reports.ts` (403).
4. Counts the report against five per client address and a hundred in all
   per day (429). The counters live on Convex through `games.consumeRateLimit`
   when `GAMES_SERVER_SECRET` is set, so every instance shares them;
   without it, each instance counts on its own.
5. Looks up the reply address's domain in DNS and refuses one with no mail
   exchanger (422), so a typo is caught while the player can still fix it.
   A lookup that fails is not held against the player.
6. Sends the email through Resend, from `PROBLEM_REPORT_FROM_EMAIL` (else
   `CONTACT_FROM_EMAIL`) to `PROBLEM_REPORT_TO_EMAIL` (else
   `CONTACT_TO_EMAIL`), with the player's address on Reply-To (502 when it
   does not go out, 503 when mail is not configured). The subject reads
   `[Freight Fate 1.9.6] crash: The window closed`.

The route never emails the player, and the game never holds a mail
password. To stop taking reports from one address, add it to
`PROBLEM_REPORT_BLOCK` and redeploy.
