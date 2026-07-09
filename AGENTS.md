# Agent Notes

## Shipping user-facing features requires a What's New entry

CI enforces this on every push and PR to `dev` and `main` (the
"Announcement check" job in `.github/workflows/ci.yml`): if the commit
range contains a conventional `feat:` commit that is user-facing, the
range must also touch `data/whats-new.json`, or the build fails before
any deploy.

When you ship a feature, add an entry to `data/whats-new.json`:

- `id`: `YYYY-MM-DD-short-slug` (lowercase letters, digits, hyphens — the
  format is regex-enforced)
- `date`: strict `YYYY-MM-DD`
- `project`: e.g. "The Midnight Signal", "Freight Fate", "Site"
- `title`: must read well in a bare list of headings
- `body`: array of non-empty plain-prose paragraphs
- optional `link`: `href` + `label`; the label must be descriptive and at
  least 15 characters ("Read more" and friends fail the build)

The entry format is validated twice — by `lib/whats-new.test.ts` in the
Test step and by `lib/whats-new.ts` during `next build` — and it feeds
both the `/whats-new` page and the RSS feed at `/whats-new/feed.xml`.

Escape hatches:

- Internal-scope feats are exempt automatically: `feat(ci)`, `feat(build)`,
  `feat(deps)`, `feat(dev)`, `feat(infra)`, `feat(test)`, `feat(tests)`,
  `feat(tooling)`.
- A genuinely non-user-facing feature in another scope can append
  `[skip-news]` to the commit subject. Use it honestly.

## Accessibility

This site's owner and much of its audience use screen readers. UI changes
go through the accessibility review process (see the repo history for the
pattern: design consult before writing UI, delta review after). Never
ship UI without it.
