# Nuxt Module Federation

Focused workspace for the Nuxt package and example from `module-federation-vite-examples`.

## Layout

- `packages/nuxt`: local `@module-federation/nuxt` module
- `apps/remote`: Nuxt remote on port `4174`
- `apps/host`: Nuxt host on port `4173`

## Commands

```sh
pnpm install
pnpm dev
pnpm build
pnpm preview
```

For a single side:

```sh
pnpm dev:remote
pnpm dev:host
```
