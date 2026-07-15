# Nuxt Module Federation

Use Module Federation in Nuxt applications with `@module-federation/nuxt`, built on top of `@module-federation/vite`.

> [!IMPORTANT]
> `@module-federation/nuxt` is still in beta. Expect API changes while the integration settles. Please report bugs and edge cases in this repository.

## What you get

- Nuxt module wiring for Module Federation hosts and remotes.
- Convention-based component exposes from `~/components/exposed`.
- Remote Vue components registered in Nuxt for template auto-imports.
- Server-rendered remote components in production builds on writable Node deployments.
- Client and server remote entries plus an MF manifest under `/_mf`.
- `vue` and `vue-router` shared as singletons by default.

## Install

```bash
pnpm add @module-federation/nuxt
```

Add the module to both the host and remote applications.

### Remote

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@module-federation/nuxt"],
  moduleFederation: {
    config: {
      name: "remote",
    },
  },
});
```

Components placed in `app/components/exposed` are exposed automatically. For example, `app/components/exposed/Widget.vue` becomes `./Widget`.

### Host

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@module-federation/nuxt"],
  moduleFederation: {
    remoteComponents: {
      remote: ["Widget"],
    },
    config: {
      name: "host",
      hostInitInjectLocation: "entry",
      remotes: {
        remote: {
          type: "module",
          name: "remote",
          entry: "https://remote.example.com/_mf/mf-manifest.json",
          entryGlobalName: "remote",
          shareScope: "default",
        },
      },
    },
  },
});
```

Use the remote as a normal Nuxt component:

```vue
<template>
  <RemoteWidget />
</template>
```

`remoteComponents` keeps component registration deterministic when the remote manifest is unavailable during startup. When the manifest is available, the module also discovers its component exposes automatically.

See [`packages/nuxt/README.md`](packages/nuxt/README.md) for the complete option reference, component naming rules, sharing behavior, and deployment contract.

## Server rendering

Remote components render on the Nuxt server by default. Production remotes publish both `remoteEntry.js` and `remoteEntry.ssr.js`; the host loads the server entry while rendering and hydrates the same component in the browser.

The default upstream SSR loader writes fetched modules to `node_modules/.ssr-cache` below the server working directory. Use `moduleFederation.ssr: false` for read-only or serverless deployments; see the package deployment contract for details.

Development SSR requires Vite 8 or newer because the MF server runner uses Vite's ModuleRunner protocol. On older Vite versions, remote components render client-only in `nuxt dev`; production builds still render them on the server. Set `moduleFederation.ssr` to `false` to choose client-only rendering in every environment.

## Example applications

- Host: [`apps/host`](apps/host) at `http://localhost:4173`
- Remote: [`apps/remote`](apps/remote) at `http://localhost:4174`

Run both from the repository root:

```bash
pnpm install
pnpm dev
```

Or run one side:

```bash
pnpm dev:remote
pnpm dev:host
```

The ports are fixed because the host's remote URL depends on the remote remaining at `4174`.

## Build checks

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm pack:nuxt
```

For a production smoke test, start both built applications with `pnpm preview`, then open `http://localhost:4173` and confirm the remote cards are present before hydration and remain interactive afterward.

## Release flow

- Versioning: Changesets (`pnpm changeset`)
- Version PR: GitHub Actions `Release Pull Request`
- Publish: GitHub Actions `Release`
- Release procedure: [`docs/RELEASING.md`](docs/RELEASING.md)

## Repository layout

- Package: `packages/nuxt`
- Host example: `apps/host`
- Remote example: `apps/remote`
- Package reference: `packages/nuxt/README.md`
- Release guide: `docs/RELEASING.md`
