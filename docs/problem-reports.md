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
3. Takes only the games named in `lib/problem-reports.ts` (403): Freight Fate,
   Wicket's and Hearken's template game, Hello Hearken.
4. Counts the report against five per client address and a hundred in all
   per day (429). The counters live on Convex through `games.consumeRateLimit`
   when `GAMES_SERVER_SECRET` is set on both the Worker and the Convex
   deployment, so every instance shares them; without it, each Worker
   isolate counts on its own.
5. Looks up the reply address's domain in DNS and refuses one with no mail
   exchanger (422), so a typo is caught while the player can still fix it.
   A lookup that fails is not held against the player.
6. Sends the email through Resend, from `CONTACT_FROM_EMAIL` to
   `CONTACT_TO_EMAIL`, with the player's address on Reply-To (502 when it
   does not go out, 503 when mail is not configured). The subject reads
   `[Freight Fate 1.9.6] crash: The window closed`.

The route never emails the player, and the game never holds a mail
password.

## Written on the site instead of in the game

A game can open the report in the browser instead of taking the text in
its own window. The player sees one form at `/report/<code>` with the game
and version filled in, the game's logs listed as attached (a checkbox each,
so one can be left out), an email field and a box for what happened. What
makes that work:

1. `POST /api/problem-reports/open` takes the same report with an empty
   description, runs steps 1 to 4 above, keeps the logs in Convex file
   storage under a 40-hex-digit code (`convex/problemReports.ts`, table
   `problemReportDrafts`) and answers 201 with `{ code, url }`. 503 when
   `GAMES_SERVER_SECRET` or the Convex URL is not set, 502 when a log
   could not be stored.
2. The game opens `url` in the browser. `app/report/[code]/page.tsx` reads
   the draft's names and sizes (`peek`, never the logs' text) and renders
   `components/ProblemReportForm.tsx`; a code with no draft shows an
   expired-link page. The page is not indexed.
3. The form posts `{ description, reply_to, omit }` to
   `POST /api/problem-reports/<code>`, which checks the text and the
   address the way the game route does (400 and 422 carry the `field`),
   reads the draft from Convex (`read`; 404 once it is gone), runs step 6
   and then drops the draft (`discard`). 202 `{ ok: true }` when the email
   went out; a send that fails keeps the logs for another try, and the
   page keeps a double press from sending twice.
4. A draft nobody finishes is dropped with its files after a day
   (`expireDrafts`, hourly from `convex/crons.ts`).

Staging, reading and discarding carry `GAMES_SERVER_SECRET`; the code is
the only thing the page needs, and only names and sizes are readable with
it.

## On Cloudflare Workers

The site runs on Workers (`CLOUDFLARE.md`), where a plain value reaches
`process.env` only when `cloudflare.config.ts` declares it, and a secret
reaches it once it is put on the Worker:

- The client address is `CF-Connecting-IP` (`lib/client-ip.ts`).
- To stop taking reports from one address, put it in `PROBLEM_REPORT_BLOCK`
  in `cloudflare.config.ts` and redeploy.
- `RESEND_API_KEY` and `GAMES_SERVER_SECRET` are Worker secrets
  (`cf workers secrets put NAME --worker orinks-net`). The mail addresses
  are the `CONTACT_*` values in the config.
- An oversized gzipped report is refused from the size its trailer declares,
  before it is unpacked, because workerd does not name the oversize error
  the way Node does.
- The preview Worker (`orinks-net-preview`) serves the route from every push
  to dev. With a Resend key put on it, a posted report is emailed for real:
  checked on 2026-11-12 with a plain report, a crash report with two logs,
  a refused reply domain, a game not on the list and an oversized body.
