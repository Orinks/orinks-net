# The Midnight Signal Broadcast Expansion Design

## Goal

Turn The Midnight Signal into a varied, trustworthy music game whose regular and daily broadcasts feel like produced episodes rather than a stream of interchangeable questions.

The release will add a large officially verified music bank, distinct four-choice segment formats, streamed mystery-song and sound-identification rounds, deterministic daily episode lineups, post-answer provenance, and regenerated Clyde narration. Development will happen on isolated worker branches that merge into `codex/midnight-signal-test`. Nothing from this project merges to `dev` or deploys to preview until the test branch is reviewed and approved.

## Approved Product Decisions

- Ship at least 460 new questions across modern and historical music.
- Cover at least 15 genre or subject categories and several regions and languages.
- Require an exact official source for every active question and answer.
- Use data APIs to discover and structure candidates, but do not treat community-edited APIs as final authority.
- Preserve the pre-existing general-trivia, OpenTDB, and MusicBrainz banks in
  ranked and daily selection under their original schema and license metadata.
  Keep them outside the strict official-source gate, which applies to the new
  expansion banks.
- Keep the familiar four-choice answering model while presenting questions through distinct broadcast segments.
- Stream licensed mystery-song clips online when the provider permits trivia use. Do not download or commit commercial song masters.
- Give every scored audio question an answer-safe, difficulty-matched text clue with identical scoring and progression.
- Preserve the existing keyboard-first, screen-reader-friendly, no-timer play style.
- Generate ElevenLabs narration only after question wording and choice order are locked.

## Success Criteria

The test branch is ready for review only when all of the following are true:

1. The active bank contains at least 460 new questions with official provenance.
2. Every question passes schema, source, duplicate, answer, distractor, and editorial checks.
3. Regular broadcasts rotate segment types and avoid repetitive category or format runs.
4. Daily broadcasts are deterministic for a date and content version, including question order, choice order, segments, clips, and sources.
5. Reloading or resuming cannot reroll a daily episode or start clip playback automatically.
6. Mystery clips stream on explicit activation, never autoplay, never enter an offline cache, and fail into an equivalent text route without penalty.
7. Clyde narration exists for every newly voiced question and matches the visible prompt and choices.
8. Keyboard, reduced-motion, and NVDA journeys pass in the real rendered app.
9. No implementation file exceeds the repository's 1,000-line practical code limit; the current oversized game and server modules are split as part of the work.
10. The feature includes a What's New entry and passes the complete automated and manual verification bundle.

## Question Corpus

### Initial Allocation

The target is a minimum of 460 new questions:

- 50 world, traditional, folk, and Indigenous music
- 40 instruments and orchestration
- 35 pop
- 35 rock and metal
- 35 Latin and Ibero-American music
- 35 Eurovision and global contests
- 30 hip-hop and rap
- 30 R&B, soul, and disco
- 25 country, bluegrass, and Americana
- 25 jazz
- 25 Asian pop, including J-pop and K-pop
- 20 blues
- 20 electronic and dance music
- 20 soundtracks and musical theatre
- 35 classical and opera

This distribution is a floor, not a cap. The release remains balanced rather than simply taking whatever a source makes easiest to extract. At least half of contemporary award, chart, release, and artist questions concern 2000 or later.

### Source Tiers

Official institutional data may serve as final provenance for facts the institution is authoritative about:

- Library of Congress
- Smithsonian Open Access and Smithsonian Folkways
- Metropolitan Museum of Art
- UNESCO Intangible Cultural Heritage
- Recording Academy and Latin Recording Academy
- European Broadcasting Union and Eurovision
- national recording academies and official award bodies
- IFPI and official national certification bodies
- Rock & Roll Hall of Fame and government arts institutions
- exact artist, label, orchestra, museum, and instrument-maker pages

Discovery and enrichment sources include MusicBrainz, Wikidata, Discogs, Europeana, DPLA, and Openverse. A discovery record never becomes the sole final citation. Europeana and DPLA candidates should link through to the supplying institution whenever that record is available.

Spotify is excluded because its developer policy prohibits games and trivia quizzes. Apple Music is excluded from offline candidate mining because its current agreement ties catalog use to Apple Music playback and subscription access. YouTube may locate official-channel evidence, but it will not supply hidden audio or extracted song clips.

### Provenance Schema

Every authored question includes:

```ts
type QuestionSource = {
  publisher: string;
  title: string;
  url: string;
  accessedAt: string; // strict YYYY-MM-DD
  evidenceSummary: string;
};
```

The URL uses HTTPS and points to the exact official page that proves the answer, not a homepage or search page. The evidence summary is editorial-only and does not reach the pre-answer client payload.

After answering, feedback renders plain text `Verified source:` followed by one native same-tab link whose visible and accessible name is the full descriptive source title. Non-HTML destinations add a visible suffix such as `(PDF)`. Provenance remains visible until Continue is activated.

### Question Schema

```ts
type QuestionFormat =
  | "award-desk"
  | "chart-wire"
  | "world-signal"
  | "instrument-detective"
  | "studio-lab"
  | "night-timeline"
  | "archive-clue"
  | "odd-one-out"
  | "needle-drop"
  | "sound-lab";

type AuthoredQuestion = {
  id: string;
  category: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  format: QuestionFormat;
  prompt: string;
  choices: [string, string, string, string];
  answer: 0 | 1 | 2 | 3;
  explanation: string;
  source: QuestionSource;
  aliases?: string[];
  pronunciation?: Record<string, string>;
  clip?: MysteryClip;
};
```

Question IDs are stable and never reused. Visible text uses Unicode NFC with official spelling and diacritics. Pronunciation metadata may improve delivery but must not change visible wording or identity.

### Authoring Gates

Hard failures include invalid or duplicate IDs, anything other than four distinct choices, an invalid answer index, duplicate prompts, unsupported sources, answer/source leakage, all-or-none choices, missing text fallback, or private answer/source fields escaping through the sanitized pre-answer payload.

Warnings requiring editorial sign-off include prompts over 25 words, negative or trick wording, a choice more than twice the median choice length, non-ASCII names without reviewed pronunciation, fuzzy leakage, narrow source coverage, and repeated templates.

Mandatory human checks include official-page evidence, plausible parallel distractors, one-hearing clarity, pronunciation, explanation usefulness, and audio/transcript parity.

## Broadcast Segments

The segment layer changes framing, selection rules, and optional media while retaining the proven four-choice answer transaction.

- **Award Desk:** winners, categories, credited roles, and award history.
- **Chart Wire:** ranks, certifications, points, and dated chart snapshots.
- **World Signal:** countries, languages, traditions, and culturally grounded instruments.
- **Instrument Detective:** construction, family, mechanism, register, and image or sound clues.
- **Studio Lab:** recording technology, production, MIDI, acoustics, and orchestration.
- **Night Timeline:** releases, inductions, inventions, and performances in chronological context.
- **Archive Clue:** identify an artist, work, or object from three concise sourced clues.
- **Odd One Out:** choose the item that does not share a sourced property with the others.
- **Needle Drop:** identify a streamed recording from a short clip plus an equivalent text clue.
- **Sound Lab:** identify an instrument, technique, or texture from a streamed or rights-cleared cue plus an equivalent text clue.

All instructions use consistent terms and remain available on screen. There are no countdowns, forced answers, auto-advance transitions, or score penalties for replaying a clip.

### Regular Broadcasts

Regular runs use weighted segment pools while avoiding the same segment twice in a row, immediate category repeats, and lopsided answer positions. Media segments remain special rather than dominating a run. Network failure degrades the same question to its text route without rerolling.

### Daily Broadcasts

A daily episode is derived from `UTC date + content version + episode rules version`. The episode persists its content version, question IDs, choice order, segment family, clip ID, and other seeded decisions. Adding questions during a day cannot alter an episode already generated for that date.

Daily lineups deliberately balance segment families. Two clean browser profiles on the same date receive identical gameplay content. Accessibility preferences affect presentation only; they never affect seed, score, eligibility, or leaderboard treatment.

## Streamed Mystery Clips

### Provider-Neutral Model

```ts
type MysteryClip = {
  id: string; // opaque internal ID
  provider: "audius" | "feed-clips" | "remote-open";
  providerAssetId: string; // server-only before answer
  startSeconds: number;
  durationSeconds: number;
  textClue: string;
  attribution: {
    creator: string;
    copyrightNotice: string;
    licenseTitle: string;
    licenseUrl: string;
    sourceTitle: string;
    sourceUrl: string;
  };
};
```

The browser receives an opaque clip ID and a same-origin playback endpoint. Provider IDs, artist names, source titles, and answer-bearing metadata stay server-side until answer feedback. Playback endpoints use `Cache-Control: no-store`, preserve byte-range streaming, and never write audio to disk or a service-worker cache. The audio element uses `preload="none"` and fetches only after Play is activated.

### Audius

Audius is the first working online provider. Its Open Music License grants API music players rights to stream licensed material in whole or part and requires attribution for commercial use. Creators can disable API streaming, so the runtime confirms that a track remains streamable and fails safely if it is withdrawn.

Each curated Audius clip retains the opaque track ID, artist-published metadata snapshot, canonical Audius URL, access date, OML URL, and attribution/copyright line. The player streams from Audius and never downloads or republishes the master. Explicit tracks are excluded initially. A clip is rejected if compliant attribution cannot be established.

Live verification confirmed that Audius returns an opaque redirect to an `audio/mpeg` stream with byte-range support and permissive CORS, allowing browser seeking without creating a local copy.

### Feed Clips

Feed.fm's Feed Clips product advertises pre-cleared major-label clips, secure signed URLs, exact clip selection, rights reporting, and music-trivia use. It requires a commercial agreement, credentials, territory controls, reporting endpoints, and the provider's current requirements.

The codebase includes a disabled Feed Clips adapter and environment contract. No Feed.fm clip enters the game until the owner has an executed agreement, credentials, allowed territories, and confirmation that The Midnight Signal is covered. Secure URLs are ephemeral and never persisted beyond provider rules.

### Remote Open or Institution-Hosted Audio

This provider covers explicitly licensed creator-hosted, government-hosted, CC BY, CC0, and public-domain recordings. Every asset still requires an item-level rights ledger. A public-domain composition does not prove that a particular recording is reusable.

If an upstream host cannot stream reliably with CORS and byte-range support, the item is not used in scored play. The project will not silently copy it into the repository as a workaround.

### Playback Behavior

- Never autoplay a mystery clip.
- Stop Clyde and Producer speech before playback.
- Pause or suppress the question bed while a clip plays and restore the exact prior state afterwards.
- Keep the clip player separate from host narration so `R` continues to replay Clyde's last spoken line.
- Expose stable native buttons named `Play mystery clip`, `Pause mystery clip`, and `Replay mystery clip`.
- Stop and clean up on answer, Continue, phase change, reload, quit, failure, and unmount.
- Reset to the beginning and remain silent after resume.
- Stop the clip before feedback begins.
- On provider or network failure, restore background audio, show a specific error, announce it once, and keep the text clue and answers usable.

## Accessibility Contract

Every scored media question includes a short, always-available equivalent text clue independent of captions, host audio, or player settings. It uses the same choices, score, progression, mutators, boosts, and leaderboard eligibility as the audio route.

The interaction order is:

1. focused question H2
2. equivalent clue
3. clip controls when present
4. answer controls
5. boosts and global controls

The Announcer component remains the sole live-region owner and does not speak over music. Prompt, feedback, pause/end/error, and source updates must not double-announce through both focus and live regions.

The final implementation must pass keyboard-only testing, NVDA with Firefox, a secondary Chromium check, reduced-motion modes, blocked media requests, daily comparison in separate profiles, and resume from both ready and interrupted playback states.

## Architecture

The current oversized game component and server module are split rather than expanded further.

Expected responsibilities include typed question metadata and sanitization, deterministic episode planning, answer resolution, format-aware selection, focused question rendering, persistent feedback, an isolated stream player, audio-channel coordination, an opaque no-store playback endpoint, provider adapters, and an editorial validator.

Exact module names may change to match existing boundaries, but these responsibilities remain split and implementation files stay at or below 1,000 lines.

## Offline Editorial Pipeline

External fact APIs are build-time editorial inputs, not runtime gameplay dependencies.

1. Fetch or import candidate facts with provider IDs and retrieval dates.
2. Normalize candidates into a staging representation.
3. Generate only deterministic template-based prompts and distractor candidates.
4. Verify every answer against an exact official page.
5. Run validators and editorial review.
6. Commit only accepted authored questions and compact provenance metadata.
7. Freeze wording and choice order.
8. Run the TTS dry-run and listening review.
9. Generate narration within the existing ElevenLabs quota.

Raw bulk API responses and one-time scraping output are not committed unless needed as durable legal or editorial evidence.

## ElevenLabs Narration

The generator remains build-time only. The external key file is read into the process environment and is never printed, copied, or committed. The configured voices and `eleven_flash_v2_5` model are available.

The active account had 14,344 credits remaining during design verification. The 90-question pilot is approximately 16,762 narrated characters, or about 8,381 Flash credits. The full 460-question bank will be generated in quota-aware batches. Paid overage is not authorized automatically.

Narration is deterministic from the visible prompt and numbered choices. Editing either changes the audio hash and queues regeneration. The manifest validator proves that each voiced question maps to an existing file and reports stale or orphaned assets.

## Branch and Merge Plan

- `codex/midnight-signal-test`: integration and final verification
- `codex/midnight-official-question-bank`: schema, validators, verified corpus, provenance, and TTS inputs
- `codex/midnight-segment-engine`: episode planning, daily versioning, server modularization, and selection
- `codex/midnight-mystery-clips`: stream providers, player, audio coordination, equivalent clues, and failure behavior
- `codex/midnight-broadcast-polish`: host copy, framing, feedback, settings/help, and What's New
- `codex/midnight-voice-pack`: generated narration and manifest after wording freezes

Each worker branch starts from the confirmed `origin/dev` baseline and lands as a focused Conventional Commit. Dependent work builds from stable commits, never another worktree's uncommitted files.

Recommended merge order into the test branch:

1. official question schema and validator
2. segment engine and daily versioning
3. mystery clip streaming and accessible player
4. accepted question corpus
5. broadcast polish and documentation
6. generated voice pack
7. conflict audit, full verification, and handoff

## Verification

Automated verification includes question schema and official-domain checks, duplicate and leakage tests, distribution checks, sanitized payload tests, deterministic episode tests, mid-day version stability, resume persistence, provider-failure behavior, clip cleanup, replay isolation, TTS dry-run, manifest coverage, focused tests, the full test suite, lint, typecheck, and a production build.

Manual verification follows the approved acceptance matrix for regular entry, daily parity, resume, no timing, play/pause/replay, answering during playback, persistent feedback, provenance activation, blocked streaming, reduced motion, keyboard order, shortcut isolation, and complete NVDA journeys.

## Reference Sources

- [Audius Open Music License (PDF)](https://audius.org/open-music-license.pdf)
- [Audius API documentation](https://api.audius.co/v1)
- [Feed.fm guidance for licensed music trivia clips](https://blog.feed.fm/dont-miss-a-beat-why-music-trivia-apps-need-licensed-music-clips)
- [Feed Clips terms and conditions](https://www.feed.fm/clips-terms-conditions)
- [Spotify Developer Policy](https://developer.spotify.com/policy)
- [Library of Congress JSON and YAML API](https://www.loc.gov/apis/json-and-yaml/)
- [Smithsonian Open Access API and reuse guidance](https://www.si.edu/openaccess/faq)
- [UNESCO Intangible Cultural Heritage open data](https://ich.unesco.org/en/open-access-to-dive-data-01218)
- [Metropolitan Museum of Art Collection API](https://metmuseum.github.io/)

## Release Boundary

This work ends with a verified `codex/midnight-signal-test` branch and a concise handoff. Merging to `dev`, pushing a preview deployment, acquiring a Feed.fm contract, enabling paid ElevenLabs overage, or modifying production credentials requires separate owner approval.
