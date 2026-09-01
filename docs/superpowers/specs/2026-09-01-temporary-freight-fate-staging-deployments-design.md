# Temporary Freight Fate staging deployments

## Purpose

Prevent Vercel preview builds from failing while they wait for Convex preview
deployments, without turning `dev.orinks.net` into permanent infrastructure.
The dedicated staging channel exists only while Freight Fate 1.9 is under
tester review. After 1.9 ships, the site returns to ordinary Vercel previews
created from branches based on `dev`.

## Evidence and failure boundary

The failed deployments completed the Next.js production build. They failed
afterward while `npx convex deploy` was creating or updating a Convex preview:
three pushes returned HTTP 408 after roughly five minutes, and one returned an
`InvalidModules` loader error. Because Convex deployment currently runs inside
Vercel's build command, either failure marks the otherwise-valid website build
as failed.

## Career 1.9 staging phase

`dev.orinks.net` remains the named tester site. The `dev` branch is its only
automatic deployment source. It uses one permanent, production-class Convex
staging deployment and a branch-scoped deploy key.

The `dev` deployment is coordinated by GitHub Actions, rather than by Vercel's
build command. It has two explicit stages:

1. Validate and deploy Convex for `dev`.
2. Trigger the `dev` Vercel deployment against the confirmed Convex URL.

Vercel's automatic Git deployment for `dev` is disabled while this channel is
active, so it cannot race ahead of the backend stage. GitHub Actions invokes
the Vercel CLI only after Convex succeeds. Its scoped token, project IDs, and
the staging deploy key are repository environment secrets and are never exposed
to preview builds.

The repository owns a deployment wrapper used by that workflow. It identifies
the Git branch and intended environment before acting, and refuses to deploy
Convex unless the branch is exactly `dev` and the expected staging
configuration is present. Vercel's project build command becomes a normal
Next.js build with no Convex deployment side effect. Other preview branches may
read from the existing staging backend for compatible frontend work, but they
never create, replace, or update a Convex deployment.

Before a staging deployment, CI runs the full site tests, repository TypeScript
typecheck, lint, and `convex deploy --dry-run --typecheck try`. A real Convex deployment
may retry a small number of times only for transient HTTP 408 or 5xx failures.
Schema, type, authorization, configuration, and module-loading failures stop
immediately.

Every deployment log states:

- the Git branch and Vercel environment;
- whether Convex deployment is enabled or intentionally skipped;
- the classified Convex target, without printing credentials;
- the commit being deployed.

The Vercel build must not silently fall back to a different Convex backend. A
missing or contradictory target configuration is a hard failure on `dev`.

## Feature preview behavior during 1.9 development

Feature branches continue to receive ordinary Vercel preview URLs. These are
frontend previews against the currently deployed staging API. A feature branch
that changes the Convex contract must pass automated Convex tests and dry-run
validation, but its Vercel preview does not deploy that backend change. Backend
behavior is exercised in tests or in an explicitly created, short-lived Convex
preview outside the automatic Vercel build.

This avoids races where two feature previews overwrite one shared backend and
avoids provisioning a new Convex deployment for every cosmetic preview.

## Post-1.9 teardown

The 1.9 release checklist includes a required staging teardown:

1. Remove the `dev.orinks.net` Vercel alias.
2. Remove the `dev`-scoped staging Convex deploy key, staging-only URL
   variables, and protected Vercel CLI credentials from GitHub.
3. Disable the staging-only GitHub Actions workflow and remove the temporary
   rule that suppresses Vercel's automatic `dev` deployment.
4. Restore the normal Vercel Git integration used before 1.9: branches based on
   `dev` receive ordinary `orinks.net` project previews with no automatic
   Convex mutation.
5. Confirm ordinary Vercel previews still build from feature branches based on
   `dev` without deploying Convex.
6. Archive or delete the temporary Convex staging deployment only after its
   data-retention decision is made separately.
7. Verify `orinks.net` production and one ordinary feature preview before
   considering teardown complete.

The staging backend is not deleted automatically. Deletion is deliberately a
separate, explicit action because it destroys data.

## Failure handling

The deploy wrapper uses bounded retries with increasing delay for transport
timeouts and server errors. It never retries `InvalidModules`, schema rejection,
type errors, bad credentials, or wrong-target detection. A failed Convex stage
does not start or promote the Vercel stage.

If Vercel succeeds but alias verification fails, the deployment remains
available at its generated URL and the pipeline reports the alias failure. It
does not redeploy Convex.

## Verification

Automated coverage verifies branch classification, skipped preview mutations,
hard failure for missing `dev` credentials, retry classification, and the
post-1.9 disabled mode. CI exercises the wrapper in dry-run mode without
production credentials.

Release verification confirms that `dev.orinks.net` serves the expected commit,
the build log names the expected Convex staging target, and a health/profile
route responds. The post-1.9 checklist verifies the alias is gone and feature
previews remain functional.

## macOS source builds

Freight Fate's separate macOS source-build issue is fixed in the game
repository by defining a non-forced Cargo environment default:

```toml
[env]
CMAKE_POLICY_VERSION_MINIMUM = { value = "3.5", force = false }
```

This supplies the compatibility floor required by bundled SDL2 under current
CMake releases while preserving any value already set by the contributor. A
repository check protects the setting, and the Mac source-build instructions
mention why it exists.
