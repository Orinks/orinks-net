# The Midnight Signal Broadcast Expansion Implementation Plan

## Outcome

Build the approved broadcast expansion on isolated feature branches and merge only verified commits into `codex/midnight-signal-test`. The finished test branch must contain at least 460 new officially sourced questions, ten produced segment families, deterministic and versioned daily episodes, licensed online mystery clips with an equivalent text route, regenerated Clyde narration, persistent provenance feedback, accessibility proof, and release documentation.

Nothing in this plan merges to `dev`, deploys a preview, enables Feed Clips without a contract, or authorizes paid ElevenLabs overage.

## Working Rules

- Start every feature branch from the confirmed `origin/dev` baseline at `e5ec967`.
- Build dependent work only from a stable prerequisite commit, never from another worktree's uncommitted files.
- Follow red, green, refactor for every behavioral slice.
- Keep implementation files at or below 1,000 lines. Split the existing oversized game and server modules during this project.
- Keep commercial recordings online. Never commit or cache a commercial master.
- Treat official open-data APIs as editorial inputs. Research restricted award and chart sites manually from exact official pages unless written permission authorizes automation. Commit accepted authored questions and compact provenance, not raw bulk responses.
- Run a fresh accessibility delta review after implementation and complete real keyboard, NVDA with Firefox, and Chromium verification before handoff.
- Commit each coherent milestone with a Conventional Commit subject.

## Branch Map

### `codex/midnight-official-question-bank`

Owns the typed authored-question contract, source policy, validators, official-source collectors, accepted 460-question corpus, retired unsourced banks, and narration inputs.

### `codex/midnight-segment-engine`

Owns deterministic episode plans, daily version persistence, format-aware selection, answer-position balancing, server modularization, and resume stability.

### `codex/midnight-mystery-clips`

Owns the private clip catalog, Audius and provider adapters, no-store streaming route, audio coordination, equivalent text route, playback state machine, and accessible player.

### `codex/midnight-broadcast-polish`

Owns segment framing, question and feedback components, source disclosure, help copy, daily presentation, the feedback speech cleanup, and What's New.

### `codex/midnight-voice-pack`

Owns quota-aware ElevenLabs generation, the generated question audio files, the final manifest, and narration coverage proof after all wording is frozen.

### `codex/midnight-signal-test`

Owns the approved design and plan, ordered merges, integration fixes, full automated verification, manual acceptance evidence, and the go or no-go handoff.

## Milestone 1: Lock the Authored Question Contract

**Branch:** `codex/midnight-official-question-bank`

**Create or change:**

- `convex/questionTypes.ts`
- `convex/questionBank.ts`
- `convex/questionBank.test.ts`
- `scripts/trivia/validate-question-bank.mjs`
- `scripts/trivia/validate-question-bank.test.ts`
- `package.json`
- `data/trivia/README.md`

### Red

Add failing tests that prove:

- every authored record has a stable ID, category, integer difficulty from 1 through 5, one of the ten approved formats, one prompt, exactly four distinct choices, one valid answer index, an explanation, and a complete source;
- source URLs use HTTPS, identify an approved official publisher, point beyond a generic homepage or search page, and contain strict `YYYY-MM-DD` access dates;
- prompts and choices are Unicode NFC and IDs and normalized prompts are unique across every active bank file;
- clip questions require a non-empty equivalent text clue and complete attribution while non-clip questions cannot carry partial clip data;
- a public pre-answer question never contains `answer`, `explanation`, `source`, `evidenceSummary`, `providerAssetId`, attribution, creator, title, or copyright fields;
- a post-answer result can expose the exact descriptive source title and URL only after answer resolution;
- deprecated OpenTDB and MusicBrainz files are not loaded by the active bank;
- hard errors fail the command and editorial warnings are listed separately.

Run the focused tests and preserve the failing output:

```powershell
npm test -- convex/questionBank.test.ts scripts/trivia/validate-question-bank.test.ts
```

### Green

Implement the pure shared types, explicit private and public question shapes, sanitizer, source-domain policy, question-bank loader, and validator. Keep answer-bearing and provider-bearing metadata on the server. Add `npm run trivia:validate` without adding a runtime network dependency.

The validator must report counts by category, format, difficulty, source publisher, source URL, region, and contemporary year where present. It must also report prompt length, choice-length imbalance, repeated templates, non-ASCII pronunciation review, and source concentration as warnings.

### Refactor and verify

Run:

```powershell
npm test -- convex/questionBank.test.ts scripts/trivia/validate-question-bank.test.ts
npm run trivia:validate
npm run typecheck
```

Expected milestone commit:

```text
feat(midnight-signal): require verified question provenance
```

## Milestone 2: Add Repeatable Official-Source Collectors

**Branch:** `codex/midnight-official-question-bank`

**Create or change:**

- `scripts/trivia/collect-official-music.mjs`
- `scripts/trivia/sources/met.mjs`
- `scripts/trivia/sources/loc.mjs`
- `scripts/trivia/sources/smithsonian.mjs`
- `scripts/trivia/sources/unesco.mjs`
- `scripts/trivia/sources/manual-records.mjs`
- `scripts/trivia/sources/shared.mjs`
- `scripts/trivia/sources/*.test.ts`
- `.gitignore`
- `data/trivia/README.md`

### Red

Use small checked-in JSON fixture fragments copied from the official open-data response shapes and authored fixture records for manual sources. Add failing tests for:

- Metropolitan Museum of Art Collection API objects;
- Library of Congress JSON API records;
- Smithsonian Open Access records and the explicit CC0 metadata flag;
- UNESCO musical-heritage records;
- manually researched Recording Academy, Latin Recording Academy, Eurovision, Rock Hall, IFPI, and RIAJ records with exact official URLs but no automated fetch path;
- entity decoding, Unicode preservation, response-date capture, official canonical URL capture, pagination, retries, throttling, and source-specific parse failures;
- deterministic normalized candidate output from the same response;
- refusal to accept community trivia APIs as final authority.

Run:

```powershell
npm test -- scripts/trivia/sources
```

### Green

Implement editorial-only collectors for the Met, Library of Congress, Smithsonian Open Access, and UNESCO with explicit user-agent identification, conservative request rates, response timeouts, retry limits, rights-field filtering, and a staging output outside version control. Do not automate sources whose terms prohibit harvesting or whose data license is unclear.

Use Smithsonian's published bulk metadata when no Open Access API key is configured. Treat UNESCO's annual open JSON or CSV graph as a browser-assisted editorial download when its web-application firewall blocks scripted retrieval; it is never a CI or runtime dependency.

Provide a strict manual-record importer for Recording Academy, Latin Recording Academy, Eurovision, Rock Hall, IFPI, RIAJ, and similar authoritative pages. It validates a human-authored fact tuple and its exact official URL, but it never requests or scrapes those sites. Written permission is required before adding any automated adapter for them.

Each normalized candidate must retain the official publisher, exact page title, canonical URL, retrieval date, stable provider record ID where available, and only the source fields needed for authoring. The collector must never emit a finished question without passing through the authoring and validation gates.

### Live proof

Run a small live sample from each available source and record counts without committing raw responses:

```powershell
node scripts/trivia/collect-official-music.mjs --source met --limit 10
node scripts/trivia/collect-official-music.mjs --source loc --limit 10
node scripts/trivia/collect-official-music.mjs --source smithsonian --limit 10
node scripts/trivia/collect-official-music.mjs --source unesco --limit 10
```

Expected milestone commit:

```text
feat(midnight-signal): collect official music facts
```

## Milestone 3: Author and Audit the 460-Question Corpus

**Branch:** `codex/midnight-official-question-bank`

**Create or change:**

- `data/trivia/questions/official-world-instruments.json`
- `data/trivia/questions/official-modern-awards.json`
- `data/trivia/questions/official-charts-contests.json`
- `data/trivia/questions/official-studio-history.json`
- `data/trivia/questions/official-asian-music.json`
- `data/trivia/questions/retired/general-trivia.json`
- `data/trivia/questions/retired/musicbrainz-generated.json`
- `data/trivia/questions/retired/opentdb-music.json`
- `convex/questionBank.ts`
- `data/trivia/README.md`

### Required allocation

Author at least 460 accepted questions and meet every floor from the design:

- 50 world, traditional, folk, and Indigenous music;
- 40 instruments and orchestration;
- 35 pop;
- 35 rock and metal;
- 35 Latin and Ibero-American music;
- 35 Eurovision and global contests;
- 30 hip-hop and rap;
- 30 R&B, soul, and disco;
- 25 country, bluegrass, and Americana;
- 25 jazz;
- 25 Asian pop, including J-pop and K-pop;
- 20 blues;
- 20 electronic and dance music;
- 20 soundtracks and musical theatre;
- 35 classical and opera.

### Authoring method

Use deterministic templates only to draft open-data candidates. Rotate all ten segment formats and several prompt structures. Build distractors from parallel official records in the same field, then manually reject choices that are implausible, overlapping, revealing, or structurally mismatched.

Research Grammy, Latin Grammy, Eurovision, Rock Hall, IFPI, Japan Gold Disc, and other restricted official sources manually, one accepted fact at a time. Do not use a crawler, bulk endpoint, hidden API, or copied trivia bank for these records. Questions are newly authored from the verified facts; the official page proves the answer but is not copied as question prose.

The existing 90-question pilot is input, not automatic acceptance. Apply the completed audits before import:

- rename source access fields to `accessedAt` and evidence notes to `evidenceSummary`;
- replace the five Europeana aggregator citations with underlying official institutions or re-author those items;
- shorten the three overlong correct choices and fix the overlapping mariachi distractor;
- correct the five Latin Grammy publisher labels or cite exact Latin Recording Academy pages;
- replace the Warren Zevon distractor that appears in its own prompt.

### Red

Add distribution assertions that initially fail until the full accepted corpus is present. Add tests for exact category floors, at least 15 categories, all ten formats, balanced answer positions, contemporary coverage, source diversity, no duplicate fact-template pairs, and zero active legacy questions.

### Green

Commit questions in reviewable category batches. For every batch:

1. Run the validator.
2. Independently check the official evidence and answer.
3. Review distractors and one-hearing clarity.
4. Review pronunciation and Unicode.
5. Record accepted, revised, and rejected counts.

Do not count a question toward 460 until both factual and editorial review accept it.

### Corpus proof

Run:

```powershell
npm run trivia:validate
npm test -- convex/questionBank.test.ts scripts/trivia/validate-question-bank.test.ts
node scripts/generate-tts.mjs --dry-run --only questions --budget 0
```

Expected milestone commits may be split by coherent source group:

```text
feat(midnight-signal): add verified institutional questions
feat(midnight-signal): add verified modern music questions
feat(midnight-signal): activate the official question bank
```

## Milestone 4: Split the Server and Persist Episode Plans

**Branch:** `codex/midnight-segment-engine`

**Prerequisite:** cherry-pick the stable question-contract commit from Milestone 1.

**Create or change:**

- `convex/trivia.ts`
- `convex/triviaSelection.ts`
- `convex/triviaEpisode.ts`
- `convex/triviaAnswers.ts`
- `convex/triviaRunState.ts`
- `convex/schema.ts`
- `convex/trivia.test.ts`
- `convex/triviaEpisode.test.ts`
- `convex/triviaSelection.test.ts`

### Red

Add failing tests that prove:

- the same regular seed and bank version produce the same planned question IDs, authored choice order, formats, clip IDs, and answer positions;
- regular selection avoids consecutive segment formats and immediate category repeats whenever eligible alternatives exist;
- media formats stay special and never appear consecutively;
- correct answer positions remain close to even across an episode;
- the authored choice order used by Clyde is the same order shown to the player and persisted in the episode;
- resuming cannot reshuffle choices or reroll a provider clip;
- private source and answer metadata still cannot escape the pre-answer payload;
- all public Convex function names and existing gameplay behavior remain compatible after the split;
- every resulting implementation file stays at or below 1,000 lines.

### Green

Extract pure selection, planning, answer-resolution, and run-state helpers from `convex/trivia.ts`. Introduce stable content and episode-rules version constants. Persist a compact episode deck containing question ID, the authored choice order or its immutable content hash, format, and opaque clip ID. Balance answer positions by selecting across authored answer indices instead of runtime choice shuffling, so Clyde narration always matches the visible order. Keep the public Convex module as a thin function boundary.

### Verify

Run:

```powershell
npm test -- convex/trivia.test.ts convex/triviaEpisode.test.ts convex/triviaSelection.test.ts
npm run typecheck
```

Expected milestone commit:

```text
refactor(midnight-signal): split episode game logic
```

## Milestone 5: Freeze Nightly Daily Broadcasts

**Branch:** `codex/midnight-segment-engine`

**Create or change:**

- `convex/schema.ts`
- `convex/triviaEpisode.ts`
- `convex/trivia.ts`
- `convex/trivia.test.ts`
- `convex/triviaEpisode.test.ts`

### Red

Add failing two-profile tests that prove:

- the first start for a UTC date creates one persisted daily episode keyed by date;
- that record stores content version, rules version, seed, question IDs, choice order, formats, clip IDs, and all other seeded decisions;
- a second profile on the same date receives identical gameplay content;
- adding or reordering bank data after the first daily episode exists does not change it;
- reload, reconnect, and resume use the same persisted plan;
- accessibility preferences change presentation only;
- a new UTC date creates a new episode;
- incomplete old runs with a still-supported content version remain resumable.

### Green

Add a `dailyEpisodes` table and link runs to the frozen daily episode. Generate atomically inside the start mutation, reusing an existing date record when present. Derive the seed from date, selected content version, and rules version, then persist every outcome rather than depending on future bank order.

### Verify

Run the complete trivia server test suite twice to catch hidden state or ordering dependence:

```powershell
npm test -- convex/trivia.test.ts convex/triviaEpisode.test.ts
npm test -- convex/trivia.test.ts convex/triviaEpisode.test.ts
```

Expected milestone commit:

```text
feat(midnight-signal): freeze daily episode lineups
```

## Milestone 6: Ship the Ten Segment Families

**Branch:** `codex/midnight-segment-engine`

**Create or change:**

- `convex/triviaSelection.ts`
- `convex/triviaEpisode.ts`
- `convex/triviaSelection.test.ts`
- `data/trivia/segments.json`
- `data/trivia/README.md`

### Red

Add failing tests for each segment instruction, eligible question format, regular weighting, daily lineup balancing, fallback when one pool is unavailable, no answer leakage in framing, and deterministic segment selection.

### Green

Implement Award Desk, Chart Wire, World Signal, Instrument Detective, Studio Lab, Night Timeline, Archive Clue, Odd One Out, Needle Drop, and Sound Lab as data-driven framing and selection rules around the existing four-choice transaction. Do not add timers, auto-advance, or penalties for replay.

### Verify

Run:

```powershell
npm test -- convex/triviaSelection.test.ts convex/triviaEpisode.test.ts
npm run typecheck
```

Expected milestone commit:

```text
feat(midnight-signal): produce varied broadcast segments
```

## Milestone 7: Add the Private Licensed Clip Backend

**Branch:** `codex/midnight-mystery-clips`

**Prerequisites:** cherry-pick the stable question-contract and episode-plan commits.

**Create or change:**

- `data/trivia/clips.json`
- `lib/midnight-signal/clips/types.ts`
- `lib/midnight-signal/clips/catalog.ts`
- `lib/midnight-signal/clips/providers/audius.ts`
- `lib/midnight-signal/clips/providers/feedClips.ts`
- `lib/midnight-signal/clips/providers/remoteOpen.ts`
- `lib/midnight-signal/clips/stream.ts`
- `lib/midnight-signal/clips/*.test.ts`
- `app/api/midnight-signal/clips/[clipId]/route.ts`
- `app/api/midnight-signal/clips/[clipId]/route.test.ts`
- `public/sw.js`
- `.env.example`

### Red

Add failing tests that prove:

- unknown, withdrawn, explicit, unlicensed, or incomplete-attribution records are rejected;
- the pre-answer client receives only the opaque clip ID, text clue, start time, and duration;
- provider ID, artist, title, canonical URL, and copyright metadata remain server-only until feedback;
- Audius streamability is rechecked before playback and upstream byte ranges are forwarded;
- the same-origin response is streamed without writing a file and includes `Cache-Control: no-store`;
- upstream non-audio, timeout, redirect failure, range failure, or withdrawal becomes a typed non-blocking unavailable response;
- the service worker never caches the clip route;
- Feed Clips remains disabled without the full contract environment and never silently falls back to an unlicensed source;
- remote-open assets require item-level rights, attribution, CORS, and byte-range evidence.

### Green

Implement a server-only catalog and provider registry. Proxy the upstream response as a stream so the browser never receives the provider asset ID. Preserve safe range headers, set no-store headers, abort on disconnect, and log only opaque IDs and non-answer-bearing diagnostics.

Curate a small launch set of currently streamable Audius tracks only when the required attribution can be established. Keep Feed Clips code disabled until a signed agreement, credentials, territories, and reporting requirements are supplied.

### Live proof

Use range requests against the local route and inspect headers and transferred bytes without saving a commercial file:

```powershell
npm test -- lib/midnight-signal/clips app/api/midnight-signal/clips
npm run typecheck
```

Expected milestone commit:

```text
feat(midnight-signal): stream licensed mystery clips
```

## Milestone 8: Build the Accessible Mystery Player and Split the Game UI

**Branch:** `codex/midnight-mystery-clips`

**Create or change:**

- `app/midnight-signal/_components/GameApp.tsx`
- `app/midnight-signal/_components/game/QuestionPanel.tsx`
- `app/midnight-signal/_components/game/FeedbackPanel.tsx`
- `app/midnight-signal/_components/game/MysteryClipPlayer.tsx`
- `app/midnight-signal/_components/game/MysteryClipPlayer.test.tsx`
- `app/midnight-signal/_lib/audio.ts`
- `app/midnight-signal/_lib/audioCoordinator.ts`
- `app/midnight-signal/_lib/mysteryClipMachine.ts`
- `app/midnight-signal/_lib/mysteryClipMachine.test.ts`
- `app/midnight-signal/_lib/music.ts`
- `app/midnight-signal/_components/Announcer.tsx`

### Binding accessibility design

- Keep one stable native command button in one DOM slot. Its visible name changes among `Play mystery clip`, `Pause mystery clip`, `Replay mystery clip`, and `Retry mystery clip` according to actual media events.
- During a pending activation, keep that same button mounted, expose a visible busy state, retain focus, and guard repeated activation. Do not claim playback has started until the media event confirms it.
- Do not add `role`, `aria-label`, `aria-pressed`, a focusable audio element, a second live region, custom Tab handling, or autofocus.
- Render in this order: focused question H2, visible `Text clue:` equivalent, clip status and command, answer controls, boosts, then global controls.
- Keep answers fully usable during slow, blocked, or failed media.
- Use the existing Announcer as the sole live owner. Delay the first loading announcement until the request has remained pending for about two seconds. Deduplicate terminal events per playback attempt.
- Do not announce routine playing, buffering, or time changes over the clip. Announce one polite failure per attempt as `Mystery clip unavailable. Use the text clue, or retry.` and announce Retry once without repeating the generic loading message.
- Stop Clyde and Producer speech before clip playback. Pause or suppress the bed and restore its exact prior state after stop.
- Invalidate callbacks and clean up before answer, Continue, phase change, resume reset, quit, error, and unmount.
- Keep `R` as host-line replay only. It stops mystery playback without automatic resume, preserves focus, and ignores repeated keydown events.
- Only semantic question and feedback phase changes move focus. Media events never move focus.
- On answer, stop the clip before the feedback H2 takes focus. In feedback, obsolete clip and answer controls are no longer tab stops.
- If answer submission fails, remain in the question, retain the selected answer's focus, announce the failure, and do not resume the clip.
- Use a plain player container without a new landmark. No seek control is required for a 10–15-second clip, and playback inherits the existing game and system volume path.

### Red

Add failing state-machine and rendered-component tests for:

- idle, slow loading, immediate play success, pause, replay after end, rejected play promise, duplicate error events, Retry, intentional abort, stale callback, and unmount;
- one stable command node retaining focus while its label changes;
- no autoplay and `preload="none"`;
- explicit text clue always visible and answers never disabled by media state;
- no new live-region roles;
- one delayed loading message and one failure message per attempt;
- answer during loading and answer during playback causing no later clip sound or announcement;
- bed-state restoration and no overlap among mystery, Clyde, Producer, and music;
- `R` replay isolation and disabled-shortcut behavior;
- feedback H2 focus followed by Continue without stale player or answer tab stops.

### Green

Implement a pure playback reducer and an effectful controller around one managed audio element. Split the question and feedback panels out of `GameApp.tsx` until every implementation file is below 1,000 lines.

### Automated verify

Run:

```powershell
npm test -- app/midnight-signal/_components/game app/midnight-signal/_lib/mysteryClipMachine.test.ts
npm run lint
npm run typecheck
```

Expected milestone commit:

```text
feat(midnight-signal): add an accessible mystery player
```

## Milestone 9: Polish the Broadcast and Provenance Feedback

**Branch:** `codex/midnight-broadcast-polish`

**Prerequisite:** start from `origin/dev`, then cherry-pick the stable question, segment, and mystery-player commits.

**Create or change:**

- `app/midnight-signal/_components/GameApp.tsx`
- `app/midnight-signal/_components/game/QuestionPanel.tsx`
- `app/midnight-signal/_components/game/FeedbackPanel.tsx`
- `app/midnight-signal/_components/game/SegmentIntro.tsx`
- `app/midnight-signal/_components/SettingsPanel.tsx`
- `app/midnight-signal/page.tsx`
- `docs/midnight-signal-signal-boosts.md`
- `data/trivia/barks.json`
- `data/trivia/segments.json`
- `data/whats-new.json`

### Red

Add failing tests that prove:

- every question displays a consistent segment name and short instruction;
- source metadata is absent from the DOM before answering;
- feedback persists until Continue and contains `Verified source:` plus one descriptive same-tab native link;
- a focused feedback H2 owns only `Correct!` or `Wrong.` while the polite bundle omits that duplicate result word;
- Clyde reactions cannot overlap focused or live feedback;
- nightly copy explains that every profile receives the same frozen episode;
- help explains Play, Pause, Replay, Retry, the text route, no penalty, and the unchanged `R` shortcut;
- reduced-motion settings introduce no hidden timing or transition dependency;
- the What's New entry passes the repository schema.

### Green

Finish the produced broadcast framing, persistent source block, non-duplicating feedback speech, help and settings text, regular and nightly introductions, and release announcement. Keep segment presentation concise and never turn instructions into additional live-region chatter.

### Verify

Run:

```powershell
npm test -- app/midnight-signal lib/whats-new.test.ts
npm run lint
npm run typecheck
```

Expected milestone commit:

```text
feat(midnight-signal): polish produced broadcasts
```

## Milestone 10: Generate the Locked ElevenLabs Voice Pack

**Branch:** `codex/midnight-voice-pack`

**Prerequisite:** create after all accepted question wording and choice order are merged into the local test branch, then branch from that exact commit.

**Create or change:**

- `scripts/generate-tts.mjs`
- `scripts/verify-trivia-audio.mjs`
- `scripts/generate-tts.test.ts`
- `public/audio/trivia/questions/*.mp3`
- `public/audio/trivia/manifest.json`
- `data/trivia/README.md`

### Red

Add failing tests that prove:

- the narration text is exactly the visible prompt plus numbered visible choices;
- the content hash changes for any prompt, choice, voice, model, or settings change;
- a dry-run reports existing, pending, stale, orphaned, and total characters without using the API;
- a credit ceiling prevents a request that would exceed the explicitly supplied safe batch budget;
- generation preserves all valid existing manifest entries while a partial batch runs;
- manifest verification rejects missing files, zero-length or implausibly small audio, stale hashes, unknown question IDs, and unvoiced accepted questions;
- no key value or external key-file contents can appear in logs, errors, manifests, or committed files.

### Green

Add a machine-readable planning mode and strict batch ceiling. Read the authorized key into `ELEVENLABS_API_KEY` only for the generation process. Query the current subscription before each batch, reserve a safety margin, and never enable paid extension automatically.

Generate Clyde audio with the configured professional voice and `eleven_flash_v2_5`. Listen to a representative sample from every source group, every difficulty, non-ASCII names, and every pronunciation override before continuing later batches.

### Verify

Run:

```powershell
node scripts/generate-tts.mjs --dry-run --only questions --budget 0
node scripts/verify-trivia-audio.mjs
npm test -- scripts/generate-tts.test.ts
```

Then run quota-safe generation batches. If the remaining included credits cannot cover every locked question, stop before overage, preserve the completed batch, and record the exact remaining characters. Do not represent the voice pack as complete until manifest coverage is 100 percent.

Expected milestone commit after full coverage:

```text
feat(midnight-signal): add verified question narration
```

## Milestone 11: Merge into the Test Branch

**Branch:** `codex/midnight-signal-test`

Merge or cherry-pick only stable commits in this order:

1. question contract and validators;
2. segment engine and daily versioning;
3. mystery clip backend and accessible player;
4. accepted official corpus;
5. broadcast polish and What's New;
6. complete voice pack;
7. integration-only fixes.

After every merge, run the focused tests owned by that feature before accepting the next dependency. Resolve conflicts by preserving the stronger privacy, determinism, source, and accessibility invariant.

Do not squash away the milestone history on the local test branch.

## Milestone 12: Prove the Complete Test Branch

### Automated proof

Run from a clean test worktree:

```powershell
npm ci
npm run trivia:validate
node scripts/generate-tts.mjs --dry-run --only questions --budget 0
node scripts/verify-trivia-audio.mjs
npm test
npm run lint
npm run typecheck
npm run build
```

Also prove:

- active new-question count is at least 460;
- every category floor and every format floor passes;
- no active question lacks official provenance;
- no pre-answer payload contains private metadata;
- all daily determinism and mid-day freeze tests pass;
- all clip responses are no-store and no clip route is service-worker cached;
- all accepted voiced questions have a matching current audio file;
- all implementation files are at or below 1,000 lines;
- `git status --short` is clean.

### Rendered and assistive-technology proof

Start the real app and verify regular and nightly flows in the rendered browser:

1. Complete one regular question in each non-media format.
2. Compare a nightly episode in two clean browser profiles.
3. Reload and resume from a ready clip and an interrupted clip.
4. Use only Tab, Shift+Tab, Enter, Space, number keys, and the documented `R` shortcut.
5. Exercise Play, Pause, Replay, Retry, answer-during-load, answer-during-play, and a blocked provider request.
6. Confirm the visible text clue provides an answer-safe equivalent route with identical score and progression.
7. Confirm feedback persists and the descriptive official-source link works only after answering.
8. Confirm no autoplay, no timing requirement, no audio overlap, no focus loss, and no duplicate announcements.
9. Repeat the complete journey with reduced motion.
10. Complete NVDA with Firefox and a secondary Chromium check.

Run a fresh accessibility-agent delta review on the implemented surface and address every critical or major finding before handoff.

## Handoff Gate

The go-ahead is earned only when the current test-branch files, test output, rendered behavior, audio manifest, source audit, branch history, and clean status jointly prove every success criterion from the approved design.

The handoff must report:

- exact test-branch commit and included milestone commits;
- accepted question count and distribution;
- official source and API coverage;
- licensed clip providers enabled and disabled;
- ElevenLabs generated, existing, pending, and credit totals;
- automated check outcomes;
- keyboard, NVDA, Firefox, Chromium, reduced-motion, blocked-stream, daily-parity, and resume outcomes;
- any remaining external contract or quota limitation;
- a clear go or no-go recommendation.

Do not merge to `dev`, push a preview, enable Feed Clips, or spend beyond included ElevenLabs credits without a new explicit owner instruction.
