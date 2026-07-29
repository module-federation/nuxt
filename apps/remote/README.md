# Nuxt Module Federation remote example

This Nuxt application provides Vue components to the host example and runs standalone at `http://localhost:4174`.

- Remote: `http://localhost:4174`
- Host consumer: `http://localhost:4173`
- Configuration: [`nuxt.config.ts`](nuxt.config.ts)
- Exposed components: [`app/components/exposed`](app/components/exposed)

## Run

Start both examples from the repository root:

```bash
pnpm install
pnpm dev
```

Or run only the remote:

```bash
pnpm dev:remote
```

The port is fixed because the host configuration points to `4174`.

## Federation wiring

`@module-federation/nuxt` automatically exposes components under `app/components/exposed`:

- `Counter.vue` as `./Counter`
- `Widget.vue` as `./Widget`

To add another auto-registered component, create `app/components/exposed/Example.vue`. After restarting the applications, a single-remote host can render it as `<RemoteExample />`.

## Federation assets

Development and production serve the federation contract from the public root:

- `http://localhost:4174/mf-manifest.json`
- `http://localhost:4174/remoteEntry.js`
- `http://localhost:4174/remoteEntry.ssr.js`

The manifest points browser assets to the application's configured `app.buildAssetsDir` (`/_nuxt` by default). The module adds CORS headers to federation assets.

## Production verification

From the repository root:

```bash
pnpm build
pnpm preview
```

Verify all three federation URLs above return successfully, then open the host at `http://localhost:4173`. Its initial HTML should already include both remote components, and their counters should become interactive after hydration.
