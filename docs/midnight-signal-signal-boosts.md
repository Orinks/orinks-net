# Midnight Signal — Signal Boosts (round-end draft) design

Status: **designed, accessibility-reviewed, not yet implemented** (July 8, 2026).
This is feature 1 of the roguelite roadmap; it introduces per-run build identity.

## Concept

After each completed round (and before the next round's first question is
served), Clyde offers a choice of one from three Signal Boosts. Boosts stack
across the run and shape how it plays. No time pressure anywhere — the game
has no timers by design (settled decision; the audience listens to full
question audio).

## Boost catalog (v1 — 9 boosts)

| Key | Name | Kind | Effect |
|---|---|---|---|
| `static-filter` | Static Filter | 2 charges | On the current question, eliminate two wrong choices. |
| `second-wind` | Second Wind | passive | The first wrong answer in each round costs no life (absorbs Double Broadcast's doubled cost too). |
| `amplifier` | Amplifier | passive | Streak bonus 25 → 40 points per consecutive correct answer. |
| `signal-lock` | Signal Lock | passive | A wrong answer halves your streak (floor) instead of resetting it. |
| `night-owl-rates` | Night Owl Rates | passive | Difficulty 4–5 questions score +50%. |
| `double-broadcast` | Double Broadcast | next round | Next round only: points ×2, but wrong answers cost 2 lives. |
| `deep-cuts` | Deep Cuts | next round | Next round only: difficulty band shifted up one tier, +75% points. |
| `spare-fuse` | Spare Fuse | instant | +1 life immediately (at the 3-life cap: +250 points instead). |
| `tune-up` | Transmitter Tune-up | passive | The bonus life comes every 2nd completed round instead of every 3rd. |

Balance notes:
- Bank distribution (564 questions): d1 55, d2 72, d3 270, d4 64, d5 103.
  Deep Cuts is a **band shift**, not "difficulty 5 only" — per-category depth
  at d5 alone is too thin for themed rounds. Night Owl Rates has 167 eligible
  questions and only comes alive from round 5+ (band 2–4), making it a
  scaling pick.
- One copy per boost per run, **except** `spare-fuse`, which may be offered
  repeatedly.
- Second Wind + Double Broadcast interaction (rule, not exception): Second
  Wind absorbs the *life cost* of the round's first wrong answer, whatever
  that cost is.

## Offer generation

At round completion the server rolls 3 distinct boost keys the run doesn't
already own (spare-fuse exempt from the ownership filter) using
`runRoll(run, "boost:" + round)` — **seeded**, so every daily player sees the
same offers on the same rounds. Player choices differ; that's the skill
expression, and it keeps the daily board fair (same inputs for everyone).
The pending offer is persisted on the run and **never re-rolled** (no offer
fishing; resume shows the identical three).

## Data

- `data/trivia/boosts.json` — client-safe copy: key, name, tagline (Clyde's
  offer line), rules text. Voice clips deferred (text-first, same pattern as
  question explanations; ~2–3k chars of barks when recorded).
- Server effect logic lives in convex code keyed by boost key (no effect
  data in the JSON that a client could tamper with — server is authoritative).

### Schema (`triviaRuns` additions)

- `modifiers` (existing, currently unused) — owned boost keys.
- `pendingBoostOffer: v.optional(v.array(v.string()))` — non-null ⇒ the run
  is in the drafting state (no current question).
- `boostCharges: v.optional(v.record(v.string(), v.number()))` — remaining
  uses for charge boosts.
- `activeRoundBoost: v.optional(v.object({ key: v.string(), round: v.number() }))`
  — Double Broadcast / Deep Cuts arming.
- `eliminatedChoices: v.optional(v.array(v.number()))` — Static Filter marks
  on the current question; cleared when the next question serves.

## Server flow

1. **`submitAnswer`** — on round completion (run survives): do NOT pick the
   next category/question. Generate the offer, patch `pendingBoostOffer`,
   clear `currentQuestionKey`, return `nextQuestion: null` plus a
   `boostOffer` event. Life-gain, tape drops, and achievements still resolve
   at round completion exactly as today. `publicRunState` gains a
   `drafting: boolean`.
2. **`chooseBoost` (new mutation)** — validates the key is in the pending
   offer; applies instant effects (`spare-fuse`); records
   modifiers/charges/`activeRoundBoost`; clears the offer; then runs the
   category pick + question serve that used to live in `submitAnswer`'s
   round-complete path. `currentQuestionServedAt` is set here, so draft time
   never counts against the anti-cheat think-time clock.
3. **`useBoost` (new mutation)** — v1 handles `static-filter` only:
   validates an active question + remaining charge, picks the two eliminated
   wrong indexes with `runRoll(run, "filter:" + questionKey)` (seeded — daily
   players who use it on the same question get the same elimination), patches
   `eliminatedChoices`, decrements the charge, returns the indexes.
4. **Scoring hooks in `submitAnswer`**: amplifier (streak bonus 40),
   night-owl-rates (×1.5 when difficulty ≥ 4), double-broadcast (×2 while
   `activeRoundBoost.round === run.round`; wrong = 2 lives), signal-lock
   (streak halves), second-wind (first wrong per round costs no life —
   tracked via existing `wrongInRound`), tune-up (life cadence 2 instead
   of 3). Server **rejects** an answer whose index is in
   `eliminatedChoices` (client also blocks it, with an announcement).
5. **`getActiveRun`** — returns the persisted offer when drafting, plus
   owned boosts and charges, so a resumed session rebuilds the draft screen
   or the in-question boost state identically.
6. **Daily determinism** — offers and filter picks derive from `run.seed`;
   dailies stay identical across players.

## UI (accessibility-lead reviewed; requirements binding)

- **Draft screen**: `h2` heading "Round N complete — choose a Signal Boost"
  (in-page `h1` persists). Focus moves to the heading (existing phase-change
  effect covers a new `draft` phase kind). Live-region announcement is the
  SHORT form only: *"Round N complete. Choose your Signal Boost. 3
  options."* on the status channel — never the full rules text (a ~30s
  utterance is un-resumable; buttons carry the details).
- **Three plain buttons** (NOT a radiogroup — matches the answer-commit
  grammar; radiogroups force NVDA forms-mode arrowing). Each button is
  self-contained, in content (not `aria-describedby`, which is
  verbosity-dependent): number, name, tagline, rules. Flavor text is real
  content — never `aria-hidden`. Number keys 1–3 gated on the existing
  `numberShortcuts` setting and `phase.kind === "draft"` + no-pick-yet;
  `aria-keyshortcuts` when enabled. `busy`/`aria-disabled` guard against
  double-activation; mutation failure announces on the alert channel and
  leaves the draft re-attemptable (mirror `chooseAnswer`'s catch).
- **Theme announcement moves**: "Next round's theme: X" leaves the
  round-complete feedback bundle and is announced at draft EXIT (when the
  question actually serves). One announcement, at the moment it's true.
- **Eliminated choices**: all 4 buttons stay in the DOM. Eliminated ones get
  `aria-disabled="true"`, a text marker in the accessible name — "2. (static
  — eliminated) <original choice text>" — visual dim + strikethrough, text
  contrast kept ≥ 4.5:1. Key numbering never shifts. Activating an
  eliminated choice (click or key) is rejected WITH an announcement
  ("Choice 2 is eliminated."), never silently. Filter-applied announcement:
  *"Static Filter applied. Choices 2 and 4 eliminated. 1 use left."*
- **Use-boost button placement**: after the 4 answer choices (own
  `role="group"` `aria-label="Signal Boosts"` if several), before the
  Replay/Pause/Mute/Quit bar — question-phase muscle memory (heading → Tab →
  choice 1) is preserved. At 0 charges, never unmount while focused (keep
  `aria-disabled` "no uses left" until the next question serves). Any
  shortcut key follows the `numberShortcuts` setting, `aria-keyshortcuts`,
  title-screen help text, and the hosted JAWS keymap.
- **Status `<dl>`** gains a Boosts row (prose: "Static Filter, 1 use left;
  Second Wind, passive"). The `dl` is the re-checkable record and stays
  non-live; every state CHANGE is announced via `announce()` when it happens.
- **Passive boosts are never silent**: trigger lines ride the SAME feedback
  bundle utterance ("Second Wind absorbed the miss — no life lost.",
  "Plus 200 points — Amplifier boosted it."), never a separate write.
- **Music**: the `draft` phase keeps the question bed playing — as an
  explicit branch in the phase→music effect, not by fallthrough.
- **Resume mid-draft**: `resumeRun` gets a draft branch (same short
  announcement + heading focus).
- **NVDA test pass additions**: draft phase browse+focus mode, elimination
  flow (verify the announcement isn't clobbered by button focus echo),
  mid-draft resume.

## Build order

1. Backend: boosts.json + schema + offer/choose/use mutations + scoring
   hooks + tests (offer determinism for dailies, each boost's effect, resume
   contract, eliminated-answer rejection, second-wind/double-broadcast
   interaction).
2. UI per the requirements above, then delta a11y review of the actual code.
3. NVDA script additions; voice barks whenever credits allow (not blocking).
