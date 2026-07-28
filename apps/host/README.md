# Nuxt Module Federation host example

This Nuxt application demonstrates local and federated server-rendered Vue components.

- Host: `http://localhost:4173`
- Remote dependency: `http://localhost:4174`
- Configuration: [`nuxt.config.ts`](nuxt.config.ts)
- App shell: [`app/app.vue`](app/app.vue)
- Page composition: [`app/pages/index.vue`](app/pages/index.vue)

## Run both applications

From the repository root:

```bash
pnpm install
pnpm dev
```

Open `http://localhost:4173`. The page should contain the host card, host SSR component, remote widget, and remote SSR component.

To run only the host:

```bash
pnpm dev:host
```

The remote must already be reachable on port `4174` for manifest discovery and remote rendering.

## Federation wiring

`nuxt.config.ts`:

- registers `@module-federation/nuxt`;
- maps the MF remote name `remote` to `http://localhost:4174/_mf/mf-manifest.json`;
- lists `Counter` and `Widget` in `remoteComponents`, keeping registration deterministic if the remote manifest is unavailable during setup;
- exposes them as `<RemoteCounter />` and `<RemoteWidget />` through Nuxt auto-imports.

The page consumes it like any other Nuxt component:

```vue
<template>
  <HostCard />
  <HostSsrComponent />
  <RemoteWidget />
  <RemoteCounter />
</template>
```

## SSR behavior

Nuxt 4.5 runs development with Vite 8 and Rolldown. Remote components render on the server during `pnpm dev`, then hydrate and remain interactive in the browser.

Production builds render the remote components on the server. Verify that path from the repository root:

```bash
pnpm build
pnpm preview
```

View the HTML source at `http://localhost:4173` and confirm it contains `Rendered by host before client hydration.` and `Rendered by remote before client hydration.` Then confirm all counters remain interactive in the browser.

The preview ports are fixed. Stop any existing process on `4173` or `4174` before starting the examples.
