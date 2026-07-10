# Music Trivia Roguelite — Question Bank & Audio Pipeline

The JSON files in this directory are the authoring source of truth for the
trivia game. Question banks are bundled directly into the Convex server
functions (see `convex/questionBank.ts` — add an import there for each new
bank file), so answers are checked server-side and never reach the client;
editing questions ships with a normal deploy. Host and question narration is
pre-generated offline with `scripts/generate-tts.mjs`, so players can never
spend ElevenLabs credits. Mystery-song audio is different: approved clips are
streamed online from rights-cleared providers and are never bundled or cached
as game assets.

## Files

- `tts.config.json` — ElevenLabs voices, model, and output paths. Put the
  real Clyde voice ID here (find it under Voices in the ElevenLabs
  dashboard). The API key does NOT go here — it lives in `.env.local` as
  `ELEVENLABS_API_KEY`.
- `barks.json` — the host's reusable personality lines, grouped by
  `trigger` (`run-intro`, `question-lead-in`, `correct`, `wrong`, `streak`,
  `last-life`, `round-transition`, `game-over`, `high-score`). The game
  picks randomly among lines sharing a trigger, so add as many variants as
  you like. This file doubles as the transcript source for captions and
  screen-reader text.
- `questions/*.json` — one file per minigame or theme. Strict official
  questions use the contract documented below: a stable unique ID, category,
  difficulty, segment format, prompt, exactly four choices, answer,
  explanation, and exact official provenance. `voice: false` skips TTS and
  `voice: "<name>"` selects another configured voice.
- `questions/retired/*.json` — preserved legacy banks that are excluded from
  runtime selection and the final official-corpus gate because they do not
  carry exact official provenance.
- `clips.json` — the server-only mystery-clip rights ledger. It stores opaque
  game IDs, provider asset IDs, clip timing, equivalent text clues, access
  dates, immutable artist-published metadata snapshots, copyright notices,
  license links, and exact source links. Provider and answer-bearing metadata
  stay out of pre-answer payloads.
- `achievements.json` — achievement definitions (key, name, description,
  secret). Unlocks are stored per player in Convex.
- `story.json` — the show bible for "The Midnight Signal": premise, the ten
  master tapes (lore collectibles unlocked in order, each gated by
  `minRound`), the five-part Channel 100 finale (gated by all ten tapes +
  `minRound` 18), the post-finale epilogue barks (triggers ending in
  `-epilogue` replace their normal counterparts once a player's
  `finaleCompletedAt` is set), and season milestone lines. All of it flows
  through the same TTS pipeline (`npm run tts -- --only story`).
- `producer.json` — the Producer's line templates. The Producer is the
  show's second host, deliberately voiced by the free Web Speech API so it
  can speak dynamic values (names, scores, ranks) — the robotic delivery is
  in character. These lines never touch ElevenLabs.
- `public/audio/trivia/manifest.json` — generated, maps line/question IDs
  to MP3 web paths. Committed (and fetched by the game client) so the game
  knows which audio exists; anything without audio yet falls back to
  on-screen text and Web Speech.

## Validating official question files

The strict authored-question contract and the exact official publisher/host
policy live in `convex/questionTypes.ts` and `official-sources.json`. Run:

```powershell
npm run trivia:validate
```

This audits the active strict files. To exercise the release gate, including
the 460-question and ten-format floors, run:

```powershell
npm run trivia:validate -- --final-gate
```

The retired legacy banks remain available under `questions/retired` for
historical reference but are never part of these active-bank checks. A
specific staged bank can be checked strictly by passing its path after the
command.

## Daily episode freezing during the corpus migration

The first daily start for a UTC date writes one immutable `dailyEpisodes` row.
It records the content/rules versions, seeded candidate order, question IDs,
format, opaque clip ID when present, and authored choice order `[0, 1, 2, 3]`.
Later starts reuse that row, so adding or reordering candidates during the day
cannot reroll the broadcast. Answer positions are balanced by choosing a
different question; choice text is never shuffled at runtime.

The retired legacy banks do not have strict `format` metadata and are not
selectable. Existing unfinished legacy runs are retired through the run
recovery path before an official-source broadcast begins. The stable version
constants live in `convex/triviaVersions.ts` and must be advanced deliberately
when corpus or planning rules change.

This validator requires Node.js 24. It directly imports the canonical
TypeScript contract using Node 24's built-in type stripping so the CLI and the
server-side model cannot drift into separate schemas.

## Official-source-only policy

Do not import community trivia banks or generate release facts from
community-edited databases. OpenTDB and MusicBrainz are not approved question
sources for this game. Each playable question must instead cite an exact
official publisher page or an approved open-data record from the institution
that owns the collection. Automated collectors only stage evidence; an editor
must write and verify the question, answer, distractors, explanation, and
disclosure before it can enter the strict bank.

## Generating audio

```powershell
npm run tts -- --dry-run        # preview what would be generated, free
npm run tts                     # generate up to 5000 characters
npm run tts -- --budget 20000   # larger explicit live ceiling
npm run tts -- --dry-run --budget 0 # complete plan; unlimited is dry-run only
npm run tts -- --only barks     # barks first — they carry the personality
npm run tts:sync                # rebuild manifest and prune retired/orphaned MP3s, no API calls
npm run tts:verify              # verify hashes, files, size, and manifest coverage
```

Files are named by a hash of voice + model + settings + text, so re-running
is safe and cheap: existing audio is skipped, and editing a line's text
automatically queues a regeneration. When monthly credits refresh, just run
it again — it reports what's still pending and your remaining credits. A live
run checks the subscription first, reserves 500 included credits by default,
and refuses an unlimited or over-quota request. It never enables paid extension
automatically.

## Streaming mystery clips

Mystery music is streamed online through
`/api/midnight-signal/clips/<opaque-id>`. The route rechecks provider
availability, forwards a single byte range, returns only audio with strict
`no-store` headers, and never writes the recording to disk. The service worker
has no fetch cache.

Audius launch records must identify a verified uploader, exclude explicit,
cover, and remix records, retain a copyright-owner notice, link the exact
track, and cite the Audius Open Music License. Availability and attribution
are rechecked before each stream. A withdrawn or changed record fails into the
question's equivalent text route.

Feed Clips remains disabled until an executed commercial agreement supplies
the allowed territories, credentials, signing rules, and reporting contract.
Environment placeholders do not enable the adapter by themselves.

Note: `eleven_flash_v2_5` bills at 0.5 credits per character, half the cost
of the multilingual model, which is why it's the default.

## Editing a question after audio exists

Changing `prompt` text changes the hash, so the old MP3 is orphaned and a
new one is queued. Delete orphans occasionally by clearing files in
`public/audio/trivia/` that no longer appear in `manifest.json`.
Changing the prompt, visible choice text, choice order, voice, model, or voice
settings changes the narration hash and queues a replacement. The answer
index is server-only and does not alter narration by itself.
