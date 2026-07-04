# Music Trivia Roguelite — Question Bank & Audio Pipeline

The JSON files in this directory are the authoring source of truth for the
trivia game. Questions get synced into the Convex `triviaQuestions` table
(answers are checked server-side so leaderboards stay honest — the client
never receives `answer` or `explanation`). Host audio is pre-generated
offline with `scripts/generate-tts.mjs`; the site only ever serves static
MP3s, so players can never spend ElevenLabs credits.

## Files

- `tts.config.json` — ElevenLabs voices, model, and output paths. Put the
  real Clide voice ID here (find it under Voices in the ElevenLabs
  dashboard). The API key does NOT go here — it lives in `.env.local` as
  `ELEVENLABS_API_KEY`.
- `barks.json` — the host's reusable personality lines, grouped by
  `trigger` (`run-intro`, `question-lead-in`, `correct`, `wrong`, `streak`,
  `last-life`, `round-transition`, `game-over`, `high-score`). The game
  picks randomly among lines sharing a trigger, so add as many variants as
  you like. This file doubles as the transcript source for captions and
  screen-reader text.
- `questions/*.json` — one file per minigame or theme. Every question needs
  a unique `id` (stable forever — it names the audio file and is the key in
  Convex), `category`, `difficulty` (1–5), `prompt`, `choices` (2+), and
  `answer` (zero-based index into `choices`). Optional: `explanation`
  (read out after answering), `voice: false` (skip TTS for this question),
  or `voice: "<name>"` (use a different configured voice).
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
- `audio-manifest.json` — generated, maps line/question IDs to MP3 web
  paths. Committed so the game knows which audio exists; questions without
  audio yet fall back to on-screen text.

## Importing questions from Open Trivia Database

```
node scripts/import-opentdb.mjs                   # up to 100 music questions
node scripts/import-opentdb.mjs --amount 300      # bigger haul
node scripts/import-opentdb.mjs --difficulty easy # easy | medium | hard
```

Free and keyless; dedupes against everything already in `questions/`, so
re-running only appends new material. Imported files carry
`"curated": false` — review them before syncing to Convex (OpenTDB is
user-contributed and has typos/awkward phrasing). Its license is
CC BY-SA 4.0, so the site needs a visible credit to opentdb.com wherever
the game lives.

## Generating audio

```
npm run tts -- --dry-run        # preview what would be generated, free
npm run tts                     # generate up to 5000 characters
npm run tts -- --budget 20000   # bigger batch (0 = unlimited)
npm run tts -- --only barks     # barks first — they carry the personality
```

Files are named by a hash of voice + model + settings + text, so re-running
is safe and cheap: existing audio is skipped, and editing a line's text
automatically queues a regeneration. When monthly credits refresh, just run
it again — it reports what's still pending and your remaining credits.

Note: `eleven_flash_v2_5` bills at 0.5 credits per character, half the cost
of the multilingual model, which is why it's the default.

## Editing a question after audio exists

Changing `prompt` text changes the hash, so the old MP3 is orphaned and a
new one is queued. Delete orphans occasionally by clearing files in
`public/audio/trivia/` that no longer appear in `audio-manifest.json`.
Changing `choices`/`answer` doesn't affect audio (only the prompt is
narrated) but does require a re-sync to Convex.
