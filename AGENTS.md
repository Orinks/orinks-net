# Agent Notes

## OmX Commit Guard

The OmX native `PreToolUse` hook enforces `git commit` message shape before Git runs.
Use a Conventional Commit subject, include a short body paragraph, then add the required
trailers as separate `-m` paragraphs:

```sh
git commit -m "fix(parser): handle empty config" \
  -m "Keeps config parsing compatible with empty project-local files while preserving the existing fallback path." \
  -m "Tested: npm test" \
  -m "Confidence: high" \
  -m "Co-authored-by: OmX <omx@oh-my-codex.dev>"
```

The guard expects `Tested:`, `Confidence:`, and
`Co-authored-by: OmX <omx@oh-my-codex.dev>`. A conventional first line is fine as
long as the body/trailers are present in this shape.
