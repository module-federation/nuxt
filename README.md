# Nuxt Module Federation

Use Module Federation in Nuxt applications with `@module-federation/nuxt`, using Vite or Rspack.

> [!IMPORTANT]
> `@module-federation/nuxt` is still in beta. Expect API changes while the integration settles. Please report bugs and edge cases in this repository.

## What you get

- Nuxt module wiring for Module Federation hosts and remotes.
- Convention-based component exposes from `~/components/exposed`.
- Remote Vue components registered in Nuxt for template auto-imports.
- Server-rendered remote components with Vite or Rspack in development and production on writable Node deployments.
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

## Server rendering

Remote components render on the Nuxt server by default. Production remotes publish both `remoteEntry.js` and `remoteEntry.ssr.js`; the host loads the server entry while rendering and hydrates the same component in the browser.

The default upstream SSR loader writes fetched modules to `node_modules/.ssr-cache` below the server working directory. Use `moduleFederation.ssr: false` for read-only or serverless deployments; see the package deployment contract for details.

With Vite, the MF server runner uses Vite 8's ModuleRunner protocol. With Rspack, the module publishes a portable server bundle graph and loads it through the same SSR runtime contract. Both builders render remote components during `nuxt dev` and production. Set `moduleFederation.ssr` to `false` to choose client-only rendering in every environment.

## Example applications

- Vite host: [`apps/host`](apps/host) at `http://localhost:4173`
- Vite remote: [`apps/remote`](apps/remote) at `http://localhost:4174`
- Rspack host: [`apps/host-rspack`](apps/host-rspack) at `http://localhost:4175`
- Rspack remote: [`apps/remote-rspack`](apps/remote-rspack) at `http://localhost:4176`

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

The ports are fixed because each host's remote URL depends on its remote remaining at the configured port.

### Rspack

Nuxt's Rspack builder creates its compilers through Rsbuild, then exposes the generated low-level configuration through Nuxt's `rspack:config` hook. The module attaches `@module-federation/enhanced/rspack` there. Browser builds enable `experiments.asyncStartup`; server builds intentionally use synchronous startup for Nuxt SSR.

Install the builder and select it in each application:

```bash
pnpm add -D @nuxt/rspack-builder
```

```ts
export default defineNuxtConfig({
  builder: "rspack",
  modules: ["@module-federation/nuxt"],
  moduleFederation: {
    config: {
      name: "host",
      remotes: {
        remote: "remote@https://remote.example.com/_mf/mf-manifest.json",
      },
    },
  },
});
```

Rspack remotes publish `remoteEntry.js`, `remoteEntry.ssr.js`, manifest SSR metadata, and a portable server chunk graph under the configured `app.buildAssetsDir`. Hosts use the server entry before hydration and the browser entry afterward.

Nuxt's Rspack development middleware accepts only same-origin asset requests. The dedicated Rspack host proxies the remote's manifest, entry, and chunks through `localhost:4175`; see [`apps/host-rspack/nuxt.config.ts`](apps/host-rspack/nuxt.config.ts). Deployed applications can use direct remote URLs when their production server permits cross-origin federation assets.

Run the example pair with Rspack:

```bash
pnpm dev:rspack
```

## Build checks

```bash
pnpm typecheck
pnpm build
pnpm build:rspack
pnpm test
pnpm test:e2e
pnpm pack:nuxt
```

For a production smoke test, start both built applications with `pnpm preview` or `pnpm preview:rspack`, then open the matching host and confirm the remote cards are present before hydration and remain interactive afterward.

## Release flow

- Versioning: Changesets (`pnpm changeset`)
- Version PR: GitHub Actions `Release Pull Request`
- Publish: GitHub Actions `Release`
- Release procedure: [`docs/RELEASING.md`](docs/RELEASING.md)

## Repository layout

- Package: `packages/nuxt`
- Vite examples: `apps/host`, `apps/remote`
- Rspack examples: `apps/host-rspack`, `apps/remote-rspack`
- Package reference: `packages/nuxt/README.md`
- Release guide: `docs/RELEASING.md`
