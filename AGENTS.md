# AGENTS.md

## Pull request titles

PRs are squash-merged, so the PR title becomes the commit message on `main`.
The `Validate PR title` workflow (`.github/workflows/pr.yml`) rejects titles
that are not [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): subject
```

- `type` is one of `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
  `build`, `ci`, `chore`, `revert`.
- `scope` is optional. Existing scopes: `nuxt` (the published package),
  `examples` (`apps/*`), `test`.
- `subject` is lowercase, imperative, and has no trailing period.

Examples:

- `fix(nuxt): resolve Vite 8 SSR shared runtime imports`
- `feat(examples): expose Bridge export-app from Nuxt remote`
- `ci: add pkg-pr-new preview publishing`

Titles starting with `Release ` skip the check. Only the Changesets release
PR uses them.

The title does not drive versioning. For user-facing changes to
`@module-federation/nuxt`, add a changeset with `pnpm changeset`.
