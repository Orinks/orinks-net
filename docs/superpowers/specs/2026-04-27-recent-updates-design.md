# Recent Updates Design

## Goal

Add a homepage-only recent updates section that shows public activity without relying on manually written blog posts. The first version should highlight higher-signal project activity and recent music listening activity while keeping the homepage reliable when external APIs are unavailable.

## User Experience

The homepage will include a `Recent updates` section above `Featured projects`.

The section will render as accessible expandable categories using native disclosure controls:

- `Code updates`
- `Music updates`

`Code updates` should open by default. `Music updates` should open by default when recent Last.fm data is available; otherwise it can render collapsed with a concise unavailable state or be omitted if no music source is configured.

Each category will show a compact list of three to five update rows. Each row will include:

- update title
- short context or description
- source label
- date
- external link when available

The design should avoid feed noise. The homepage should feel like a useful activity snapshot, not a raw event log.

## Sources

### GitHub

Use public GitHub activity for allowlisted repos associated with featured projects.

Initial allowlist:

- `Orinks/AccessiWeather`
- `Orinks/PortkeyDrop`

Optional future allowlist entries:

- `Orinks/AccessiSky`
- `Orinks/AccessiClock`
- `Orinks/Spectra`

Code updates should prioritize higher-signal activity:

1. GitHub releases, including stable releases and prereleases/nightlies when relevant.
2. Recent default-branch commits that appear meaningful.

Merged pull requests are desirable, but they require extra GitHub API search/list calls and can be more rate-limit sensitive. The first implementation should not require them. Add merged PRs later if the feed needs more context and the deployed site has a `GITHUB_TOKEN`.

`GITHUB_TOKEN` should remain optional. When present, it raises GitHub API rate limits. When absent, the site should still build and render best-effort public activity.

### Last.fm

Use Last.fm recent scrobbles as the first music activity source.

Required environment variables for music updates:

- `LASTFM_API_KEY`
- `LASTFM_USERNAME`

The site should call Last.fm `user.getRecentTracks` and normalize recent completed scrobbles into update rows. A currently playing track can be skipped unless it includes a reliable timestamp.

### Spotify

Spotify playlist updates are a future optional enhancement. Spotify API credentials are free to create through the Spotify Developer Dashboard, but credential availability and access requirements can vary. The first implementation should not depend on Spotify.

Future environment variables:

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`

Spotify support should be added only after the Last.fm and GitHub feed is working, and it should be optional so missing Spotify credentials never break the homepage.

## Architecture

Add a small update aggregation layer:

- `lib/updates.ts`: defines shared update types and combines category data.
- `lib/github.ts`: keep existing release helpers and add narrowly scoped helpers only if needed.
- `lib/lastfm.ts`: fetches and normalizes Last.fm recent tracks.
- `components/RecentUpdates.tsx`: renders the homepage section and category disclosures.
- `app/page.tsx`: renders `RecentUpdates` above featured projects.

Suggested shared types:

```ts
export type UpdateItem = {
  title: string;
  description: string;
  href?: string;
  source: string;
  publishedAt: string;
  kind: "release" | "commit" | "track";
};

export type UpdateCategory = {
  id: "code" | "music";
  title: string;
  summary: string;
  defaultOpen: boolean;
  items: UpdateItem[];
  unavailableMessage?: string;
};
```

The aggregator should return categories rather than raw API payloads so the component stays presentation-focused.

## Data Flow

1. The homepage server component calls the recent updates aggregator.
2. The aggregator fetches GitHub and Last.fm data with Next.js `fetch` caching and revalidation.
3. Each source normalizes its records into `UpdateItem`.
4. Categories sort their own items by `publishedAt` descending and limit the visible count.
5. The `RecentUpdates` component renders categories with native disclosure controls.

Recommended cache window: 15 to 30 minutes. This is fresh enough for a personal site while reducing API pressure and keeping GitHub unauthenticated usage practical.

## Error Handling

External source failures must not break the homepage.

- GitHub failures should render a quiet code updates fallback with a link to the GitHub profile or relevant repository list.
- Missing Last.fm env vars should omit music updates or show a concise unavailable message.
- Last.fm request failures should not throw beyond the source helper.
- Invalid or partial API payloads should be ignored rather than rendered as broken rows.

## Accessibility

Use native `<details>` and `<summary>` controls for expandable categories. Keep headings structured and links descriptive. Dates should be visible text, not only machine-readable values. The section must work with keyboard navigation and screen readers without custom JavaScript.

## Testing and Verification

Minimum verification for implementation:

- `npm run lint`
- `npm run typecheck`
- `npm run build`

Manual verification:

- Homepage renders with no new env vars.
- Homepage renders with Last.fm env vars when configured.
- Code and music disclosures can be expanded and collapsed with keyboard controls.
- Source failure states do not break the page.

If a test setup is added later, cover normalization for GitHub releases/commits and Last.fm recent tracks.

## Out of Scope

- A standalone `/updates` page.
- Blog post activity.
- Required Spotify integration.
- Client-side live polling.
- New dependencies.
