# @module-federation/nuxt

Nuxt integration for Module Federation, built on top of `@module-federation/vite`.

## Requirements

- Nuxt `^4.4.8`
- Node.js `^22.18.0`, `^24.11.0`, or `>=26.0.0`
- Vite 8 or newer for server-rendered remote components during development

Production builds support server-rendered remote components on writable Node deployments regardless of the development limitation above. The default upstream SSR loader writes fetched modules under `process.cwd()/node_modules/.ssr-cache`; read-only and serverless filesystems are not currently supported for remote SSR.

## Install

```bash
pnpm add @module-federation/nuxt
```

Register the module in `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ["@module-federation/nuxt"],
});
```

## Configure a remote

Give every deployed container a unique Module Federation name:

```ts
export default defineNuxtConfig({
  modules: ["@module-federation/nuxt"],
  moduleFederation: {
    config: {
      name: "catalog",
    },
  },
});
```

Create a component under the exposed-components directory:

```text
app/components/exposed/ProductCard.vue
```

The module registers it as a local Nuxt component and exposes it to hosts as `./ProductCard`.

You can also configure exposes directly with the underlying MF Vite API:

```ts
export default defineNuxtConfig({
  modules: ["@module-federation/nuxt"],
  moduleFederation: {
    config: {
      name: "catalog",
      exposes: {
        "./catalog-app": "./app/app.vue",
      },
    },
  },
});
```

Relative expose paths resolve from the Nuxt application root.

## Configure a host

```ts
export default defineNuxtConfig({
  modules: ["@module-federation/nuxt"],
  moduleFederation: {
    remoteComponents: {
      catalog: ["ProductCard"],
    },
    config: {
      name: "shell",
      hostInitInjectLocation: "entry",
      remotes: {
        catalog: {
          type: "module",
          name: "catalog",
          entry: "https://catalog.example.com/_mf/mf-manifest.json",
          entryGlobalName: "catalog",
          shareScope: "default",
        },
      },
    },
  },
});
```

The exposed component is available through Nuxt's component auto-imports:

```vue
<template>
  <RemoteProductCard product-id="123" />
</template>
```

The module fetches each remote's `mf-manifest.json` during setup and registers valid component exposes. `remoteComponents` is the fallback list used when a manifest cannot be reached, including builds where the remote is deployed separately.

For SSR hosts, configure the remote with its manifest URL as shown above. The runtime then selects the browser or server entry from that manifest, preserves custom manifest paths, and can detect a new server build without restarting the host. Direct JavaScript entries remain supported when `mf-manifest.json` is adjacent; use the explicit manifest URL when entry and manifest directories differ.

### Component names

With one configured remote, `./ProductCard` becomes `RemoteProductCard`.

With multiple configured remotes, the remote name is included to prevent collisions. For example, `catalog/ProductCard` becomes `RemoteCatalogProductCard`.

Only expose names beginning with a letter and containing letters, numbers, underscores, or hyphens are registered as Nuxt components. Other MF exposes remain available through normal runtime imports.

## Server rendering

`ssr` defaults to `true`. When Nuxt SSR is enabled, the module creates client and server federation builds:

- The browser loads `remoteEntry.js`.
- The Nuxt server loads `remoteEntry.ssr.js`.
- The remote component's HTML is included in the host response and hydrated in the browser.

Development server federation requires Vite 8 or newer. With an older Vite version, `nuxt dev` logs an informational message and renders remote components client-only. `nuxt build` still produces server-rendered remote components.

Disable remote SSR explicitly when the remote is browser-only:

```ts
export default defineNuxtConfig({
  moduleFederation: {
    ssr: false,
    config: {
      // ...
    },
  },
});
```

If a remote fails during a server request, the host renders an empty fallback for that request so the page can still respond. Later requests retry the remote; the browser can also load the component after hydration.

Production servers re-check each remote manifest after 30 seconds by default and apply a 10-second timeout to each SSR network request. Tune these independently with `ssrManifestMaxAgeMs` and `ssrFetchTimeoutMs`. Set the fetch timeout to `0` to disable it.

The default MF Vite `temp-file` SSR loader requires the deployed process to create and update `node_modules/.ssr-cache` below its working directory. The module links that cache to the dependencies beside the deployed server entry, so launching the standalone output from another working directory remains supported. Use `ssr: false` on read-only/serverless presets. MF Vite also exposes a `vm` loader strategy, but it requires Node's experimental VM modules flag, executes in the host process rather than a security sandbox, and should be treated as an explicit deployment choice.

## Shared dependencies

When `config.shared` is not provided, `vue` and `vue-router` are shared as singletons. Their installed versions become the required versions, and the runtime uses a loaded-first strategy so the host's initialized Vue instance is reused.

Override the defaults by providing `config.shared`:

```ts
export default defineNuxtConfig({
  moduleFederation: {
    config: {
      shared: {
        vue: { singleton: true, requiredVersion: "^3.5.0" },
        "vue-router": { singleton: true, requiredVersion: "^5.1.0" },
        pinia: { singleton: true },
      },
    },
  },
});
```

During setup, the module compares manifest-provided shared versions with the host's installed versions. Major-version differences produce a warning because the server uses the host's copy without runtime version negotiation.

Server exposes bundle their non-shared npm dependencies into the published SSR graph, so a remote-only package does not need to be installed by every host. `config.ssrExternals` opts packages out of that bundling. Every consuming host must install those explicit externals at a compatible version and list them in its own `config.ssrExternals` so Nitro includes them in standalone output. The SSR loader keeps these imports as bare specifiers, preserving each package's ESM `import` export condition. Prefer `config.shared` for framework runtimes and other singleton dependencies.

Advanced `@module-federation/vite/ssrEntryLoader` `resolvedShared` mappings must point to absolute files inside named, installed packages. The module stores them as package-relative descriptors so standalone output does not retain build-machine paths; app-local file mappings fail during setup with an actionable error.

## Deployment contract

Deploy the complete Nuxt output. By default, a remote serves:

- `/_mf/remoteEntry.js`: browser remote entry
- `/_mf/remoteEntry.ssr.js`: server remote entry
- `/_mf/mf-manifest.json`: federation manifest
- `/<buildAssetsDir>/**`: Nuxt and federation chunks referenced by the entries (`/_nuxt/**` by default)
- `/remoteEntry.js`: compatibility copy for legacy direct-entry consumers

The module adds permissive CORS headers to federation and Nuxt asset routes. Put all of these routes behind the same public origin and do not rewrite one without the others.

The host must be able to reach the remote from both environments:

- Browsers need the configured public remote URL.
- The deployed Nuxt server needs network access to the same remote URL during SSR.

Remote SSR executes the remote's server entry with the host process's privileges. Configure only trusted remotes and use a direct HTTPS URL in production. MF Vite rejects redirects and permits plain HTTP only for loopback development addresses. Its server-graph fetches do not use Module Federation runtime fetch hooks, so authenticated headers, mTLS adapters, and custom proxy fetch functions are not currently supported; expose a direct trusted endpoint or set `ssr: false`.

Give each Node process an isolated writable working directory/cache. Do not run PM2 or cluster workers against one shared `node_modules/.ssr-cache`; one exiting worker can remove files used by another. Container replicas with separate filesystems are safe. Recycle exceptionally long-lived processes after many remote deployments because old fetched graphs and Node ESM modules remain resident until process exit.

For immutable releases, deploy the remote before deploying a host that references it. Keep older remote assets available while existing browser sessions still reference them.

## Options

Configure these values under `moduleFederation` in `nuxt.config.ts`.

| Option                   | Type                               | Default                  | Description                                                                                            |
| ------------------------ | ---------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `base`                   | `string`                           | `"/_mf"`                 | Public route and output directory for federation entries and the manifest.                             |
| `exposedDir`             | `string`                           | `"~/components/exposed"` | Directory whose Nuxt components are exposed automatically.                                             |
| `manifestFetchTimeoutMs` | `number`                           | `500`                    | Maximum setup time for fetching each remote manifest.                                                  |
| `manifestMetadata`       | `Record<string, unknown>`          | `{}`                     | Values merged into `metaData.custom` in generated manifest and stats files.                            |
| `remoteComponents`       | `Record<string, string[]>`         | `{}`                     | Component exposes to register when manifest discovery is unavailable.                                  |
| `ssr`                    | `boolean`                          | `true`                   | Render consumed remote components on the Nuxt server. Server exposes are still published when `false`. |
| `ssrFetchTimeoutMs`      | `number`                           | `10000`                  | Maximum time for each SSR remote network request; `0` disables the timeout.                            |
| `ssrManifestMaxAgeMs`    | `number`                           | `30000`                  | Interval before the server re-checks a remote manifest for a new release.                              |
| `config`                 | `Partial<ModuleFederationOptions>` | See below                | Options passed to `@module-federation/vite`.                                                           |

The MF Vite config defaults are:

```ts
{
  name: "remote",
  filename: "remoteEntry.js",
  manifest: { fileName: "mf-manifest.json" },
  dts: false,
  remotes: {},
  exposes: {},
}
```

User values take precedence except for `config.target`. A single MF plugin serves both Nuxt environments, so the module always owns that setting and selects `web` for the client and `node` for the server build. Setting `config.manifest` to `false` disables manifest output, manifest-based component discovery, and automatic detection of new SSR builds; configure `remoteComponents` on every host and restart long-lived hosts after remote deployments in that case.

## Verify an application

Build both the remote and host before testing the production SSR path:

```bash
pnpm typecheck
pnpm build
pnpm preview
```

Check the host response source for remote markup before JavaScript hydration, then test remote interactions in a browser. Also verify that the manifest, both remote entries, and referenced `/_nuxt` assets return successful responses from the deployed origin.
