# Nuxt Module Federation host example

This Nuxt application consumes the `remote` application and demonstrates both local and federated server-rendered Vue components.

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

Open `http://localhost:4173`. The page should contain the host card, host SSR card, remote widget, and remote counter.

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
- exposes the components as `<RemoteCounter />` and `<RemoteWidget />` through Nuxt auto-imports.

## SSR behavior

The repository currently runs Nuxt development with Vite 7. Remote components therefore render client-only during `pnpm dev`; the module logs the Vite 8 development-SSR requirement.

Production builds render the remote components on the server. Verify that path from the repository root:

```bash
pnpm build
pnpm preview
```

View the HTML source at `http://localhost:4173` and confirm it contains `I'm the remote app` and `Remote SSR component` before hydration. Then confirm both remote counters remain interactive in the browser.

The preview ports are fixed. Stop any existing process on `4173` or `4174` before starting the examples.
