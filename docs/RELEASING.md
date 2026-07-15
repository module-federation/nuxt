---
title: Releasing
summary: Release flow for @module-federation/nuxt using Changesets and GitHub Actions trusted publishing.
read_when:
  - Preparing a release
  - Publishing a preview
  - Updating release automation
updated_at: 2026-07-15
---

# Releasing

This repository uses Changesets for versioning and publishes `@module-federation/nuxt` to npm through GitHub Actions trusted publishing.

## Before merging a feature

Every user-visible package change should include a changeset:

```bash
pnpm changeset
```

Choose `@module-federation/nuxt`, select the semver impact, and describe the change in release-note language. Commit the generated `.changeset/*.md` file with the implementation.

Run the release gate from a clean checkout:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e
pnpm pack:nuxt
pnpm format:check
```

Also exercise the production examples with `pnpm preview`. Confirm server-rendered remote markup, browser hydration, remote interactions, manifest loading, both remote entries, and all referenced `/_nuxt` assets.

## Stable release flow

1. Merge feature PRs, including their changesets, into `main`.
2. Run the `Release Pull Request` workflow.
3. Review its version PR. Confirm the package version, changelog, changeset removal, and packed file list.
4. Merge the version PR after CI passes.
5. Publish the merged version using one of these supported paths:
   - Create a GitHub Release whose tag exactly matches `packages/nuxt/package.json` (for example, `0.1.0`). The `Release` workflow publishes it with npm dist-tag `latest`.
   - Manually run the `Release` workflow with `version=latest` and `branch=main`.
6. Verify the npm version, provenance, README, exports, and `latest` dist-tag.

GitHub Release tags must not start with `v`. The publish workflow rejects a tag that does not match the package version.

The version-PR workflow requires a `REPO_SCOPED_TOKEN` Actions secret with permission to push branches and open pull requests. Do not fall back to `GITHUB_TOKEN`: GitHub suppresses workflow events created by that token, so the generated release PR would not receive CI checks.

## Preview release

Run the `Release` workflow manually with:

- `version=next`
- `branch=main`

The workflow creates a Changesets snapshot version and publishes it under the npm `next` dist-tag. Preview and stable releases are main-only; use a merged changeset to validate the packed package before a stable release.

A GitHub prerelease also publishes under `next`. Its tag must match the base version in `packages/nuxt/package.json`; the workflow derives a rerun-safe `<base>-next.<workflow-run-id>` npm version.

Converting that GitHub prerelease to a stable release does not republish it. After the stable version PR is merged, run `Release` manually with `version=latest` and `branch=main`.

## First `0.1.0` checklist

- Package version and changelog describe `0.1.0`.
- Package tarball includes package metadata, `README.md`, `LICENSE`, compiled ESM, declarations, and source maps only.
- Package exports load in a clean ESM consumer.
- Host and remote build with the supported Node and Nuxt versions.
- Production host HTML contains remote SSR markup before hydration.
- Remote outage behavior is recoverable on a later request.
- Published server output contains no build-machine absolute paths.
- Generated manifests list `vue` and `vue-router` as shared singletons.
- CI, typecheck, build, tests, formatting, and package-content checks pass.
- GitHub `Publish` environment and npm trusted publisher target `release.yml`.

## Publish safeguards

- The workflow publishes from `packages/nuxt` with npm provenance.
- The workflow publishes only commits reachable from `main` and reruns the full release gate before publishing.
- Stable releases use `latest`; previews use `next`.
- Publishing skips only when the exact npm version already exists and the requested dist-tag already points to it.
- Publishing fails when an existing version would require dist-tag promotion. Create a new semver version instead.
- npm trusted publishing must be configured for:
  - repository: `module-federation/nuxt`
  - workflow: `release.yml`
  - environment: `Publish`
