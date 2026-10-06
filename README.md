# Nuxt Module Federation

Use Module Federation in Nuxt applications with `@module-federation/nuxt`, using `@module-federation/vite` or `@module-federation/enhanced/rspack` according to Nuxt's builder.

> [!IMPORTANT]
> `@module-federation/nuxt` is still in beta. Expect API changes while the integration settles. Please report bugs and edge cases in this repository.

## What you get

- Nuxt module wiring for Module Federation hosts and remotes.
- Convention-based component exposes from `~/components/exposed`.
- Remote Vue components registered in Nuxt for template auto-imports.
- Optional remote component prop, emit, and slot types through MF `dts`.
- Server-rendered remote components in development and production on writable Node deployments.
- Client and server remote entries plus an MF manifest at the public root.
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
          entry: "https://remote.example.com/mf-manifest.json",
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

## Choose a builder

Vite is the default. To use Rspack, install the builder matching your Nuxt version and set `builder: "rspack"` in both applications:

```bash
pnpm add -D @nuxt/rspack-builder@4.5.1
```

```ts
export default defineNuxtConfig({
  builder: "rspack",
  modules: ["@module-federation/nuxt"],
});
```

Both builders use the same `moduleFederation` configuration and can consume each other's manifests. Prefer manifest URLs so the runtime selects each remote's browser and server entry types. See [the builder integration notes](docs/bundlers.md) for the implementation and validation matrix.

## Server rendering

Remote components render on the Nuxt server by default. Production remotes publish both `remoteEntry.js` and `remoteEntry.ssr.js`; the host loads the server entry while rendering and hydrates the same component in the browser.

The default upstream SSR loader writes fetched modules to `node_modules/.ssr-cache` below the server working directory. Use `moduleFederation.ssr: false` for read-only or serverless deployments; see the package deployment contract for details.

Nuxt 4.5 uses Vite 8's Rolldown pipeline. The MF server runner uses its ModuleRunner protocol, so remote components render during `nuxt dev` as well as production. Set `moduleFederation.ssr` to `false` to choose client-only rendering in every environment.

## Example applications

- Host: [`apps/host`](apps/host) at `http://localhost:4173`
- Remote: [`apps/remote`](apps/remote) at `http://localhost:4174`
- Rspack host: [`apps/host-rspack`](apps/host-rspack) at `http://localhost:4175`
- Rspack remote: [`apps/remote-rspack`](apps/remote-rspack) at `http://localhost:4176`

Run all four applications from the repository root:

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

To view the built examples from another computer, run `pnpm build` and `pnpm preview`, then open this machine's network hostname on port `4173` or `4175`. The examples replace loopback remote hostnames with the browser's hostname while preserving each remote's port and path. Server rendering continues to use loopback, and explicitly configured non-loopback remote URLs stay unchanged. Use the production preview for this: Nuxt's development origin checks can reject requests over plain HTTP on the local network.

## Build checks

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e
pnpm test:e2e:dev
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
