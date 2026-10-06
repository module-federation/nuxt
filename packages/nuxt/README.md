# @module-federation/nuxt

Nuxt integration for Module Federation, using `@module-federation/vite` or `@module-federation/enhanced/rspack` according to Nuxt's builder.

## Requirements

- Nuxt `>=4.5.1`, with the default Vite builder or a matching `@nuxt/rspack-builder`
- Node.js `^22.18.0`, `^24.11.0`, or `>=26.0.0`

Production builds support server-rendered remote components on writable Node deployments. The default upstream SSR loader writes fetched modules under `process.cwd()/node_modules/.ssr-cache`; read-only and serverless filesystems are not currently supported for remote SSR.

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

## Choose a builder

Vite is the default. For Rspack, install `@nuxt/rspack-builder` at the same version as Nuxt and configure `builder: "rspack"`. The module uses Nuxt's Rspack client and server compilers, including Nuxt's Vue server transforms. Webpack and custom builder objects are rejected with an explicit error.

```bash
pnpm add -D @nuxt/rspack-builder@4.5.1
```

```ts
export default defineNuxtConfig({
  builder: "rspack",
  modules: ["@module-federation/nuxt"],
  moduleFederation: { config: { name: "catalog" } },
});
```

The common `config` options and object remote format below work with either builder. Rspack also accepts its additional plugin options, such as `experiments` and `remoteType`. Vite-specific build options such as `hostInitInjectLocation` apply only to Vite. Use manifest URLs for cross-builder remotes so the runtime discovers the correct entry type.

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

You can also configure exposes directly:

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
          entry: "https://catalog.example.com/mf-manifest.json",
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

The module fetches each remote's `mf-manifest.json` during setup and registers valid component exposes. `remoteComponents` is the fallback list used when a manifest cannot be reached, including builds where the remote is deployed separately. When `config.manifest` is `false`, the module does not fetch remote manifests during setup and registers only the exposes listed in `remoteComponents`.

For SSR hosts, configure the remote with its manifest URL as shown above. The runtime then selects the browser or server entry from that manifest, preserves custom manifest paths, and can detect a new server build without restarting the host. Direct JavaScript entries remain supported when `mf-manifest.json` is adjacent; use the explicit manifest URL when entry and manifest directories differ.

### Component names

With one configured remote, `./ProductCard` becomes `RemoteProductCard`.

With multiple configured remotes, the remote name is included to prevent collisions. For example, `catalog/ProductCard` becomes `RemoteCatalogProductCard`.

Only expose names beginning with a letter and containing letters, numbers, underscores, or hyphens are registered as Nuxt components. Other MF exposes remain available through normal runtime imports.

### Component types

Remote components are typed as Vue's generic `Component` by default. To type their props, emits, and slots from the remote source, enable MF type generation with `config.dts`:

```ts
// Remote
moduleFederation: {
  config: {
    name: "catalog",
    dts: true,
  },
},

// Host
moduleFederation: {
  config: {
    name: "shell",
    dts: { generateTypes: false },
    remotes: {
      /* ... */
    },
  },
},
```

The remote publishes `@mf-types.zip` and `@mf-types.d.ts` next to its manifest. Its declarations are generated with `vue-tsc` when it is installed, using a tsconfig that extends Nuxt's `tsconfig.app.json`.

The host downloads those types into `<rootDir>/@mf-types` when the dev server starts, and resolves `RemoteProductCard`, `#components`, and `import("catalog/ProductCard")` from them. Builds only download types when `consumeTypes.typesOnBuild` is `true`, which requires the remote to be reachable at build time. Without downloaded types, registered remote components fall back to `Component`, so type checks do not depend on a running remote. Other exposes, such as a Bridge export, still need their own declaration; declare them with a wildcard such as `declare module "catalog/bridge/*"` so downloaded types take precedence. Add `@mf-types` to `.gitignore`.

Relative `dts` paths such as `tsConfigPath`, `cwd`, and `consumeTypes.typesFolder` resolve from the Nuxt application root. These Nuxt defaults apply to the Vite builder. With `builder: "rspack"`, `config.dts` is passed to `@module-federation/enhanced` unchanged.

### Bridge application export (optional)

To expose a full routing app (not only components), install the Bridge Vue 3 adapter and its router peer, then add a Bridge entry and list it under `config.exposes`:

```sh
pnpm add @module-federation/bridge-vue3@2.8.2 vue-router@5.2.0
```

Nuxt `4.5.1` requires `vue-router@^5.2.0`. The latest published `@module-federation/bridge-vue3` is `2.8.2` and declares the older `vue-router@4` peer, so this Nuxt example intentionally keeps Nuxt's required Router 5 rather than silently installing or suppressing a conflicting peer. Bridge 2.8.2 uses the Router APIs shared by these versions; the example's Playwright coverage verifies the `/bridge` basename and child navigation. For a non-Nuxt host, follow the adapter's declared peer contract and use Vue Router 4.

```ts
// app/export-app.ts
import { createBridgeComponent } from "@module-federation/bridge-vue3";
import App from "./bridge/App.vue";
import { createBridgeRouter } from "./bridge/router";

export default createBridgeComponent({
  rootComponent: App,
  appOptions: () => ({ router: createBridgeRouter() }),
});
```

```ts
moduleFederation: {
  config: {
    name: "catalog",
    exposes: {
      "./bridge/export-app": "./app/export-app.ts",
    },
  },
}
```

Hosts load it with `createRemoteAppComponent` from `@module-federation/bridge-vue3` (or `@module-federation/bridge-react` for React/Next). Use a host catch-all such as `/catalog/:pathMatch(.*)*` so current `bridge-vue3` basename auto-detect works. An explicit `basename` option is tracked in [module-federation/core#4984](https://github.com/module-federation/core/pull/4984). Use a slashed expose name (e.g. `./bridge/export-app`) so host manifest discovery does not register the Bridge factory as a Nuxt component. See the example apps under `apps/host` and `apps/remote`.

## Server rendering

`ssr` defaults to `true`. When Nuxt SSR is enabled, the module creates client and server federation builds:

- The browser loads `remoteEntry.js`.
- The Nuxt server loads `remoteEntry.ssr.js`.
- The remote component's HTML is included in the host response and hydrated in the browser.

Nuxt 4.5 uses Vite 8's Rolldown pipeline. The same federation plugin participates in the client and server environments, so remote components render during both `nuxt dev` and production SSR.

Rspack uses Nuxt's separate server compiler for its SSR entry. A Rspack application with Nuxt's top-level `ssr: false` publishes browser assets only; its manifest does not advertise a server entry. To keep publishing server exposes while disabling remote consumption on the server, use `moduleFederation.ssr: false` and leave Nuxt SSR enabled.

Development remote manifests infer their asset origin from the manifest URL. Rspack serves emitted federation assets before Nuxt's development origin guard; unrelated development routes remain protected. This keeps `remoteEntry.js` and exposed chunks on the remote origin when the host and remote use different ports. An explicit `config.publicPath` still takes precedence.

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

During Vite setup, the module compares manifest-provided shared versions with the host's installed versions. Major-version differences produce a warning because the Vite server uses the host's copy without runtime version negotiation. Rspack also uses the host's installed Vue for SSR under the default shared Vue configuration and reports Vue version mismatches. Other Rspack server shares continue to use the federation share scope.

When a shared dependency uses `import: false`, it is not bundled as a local federation provider, but SSR remote loading still evaluates its bare import in the host process. The host must install that dependency; when `requiredVersion` is set, setup validates the installed version and fails with the package name before remote loading begins. The dependency is also included in Nitro's standalone trace.

Server exposes bundle their non-shared npm dependencies into the published SSR graph, so a remote-only package does not need to be installed by every host. `config.ssrExternals` opts packages out of that bundling. Every consuming host must install those explicit externals at a compatible version and list them in its own `config.ssrExternals` so Nitro includes them in standalone output. The SSR loader keeps these imports as bare specifiers, preserving each package's ESM `import` export condition. Prefer `config.shared` for framework runtimes and other singleton dependencies.

Advanced `@module-federation/vite/ssrEntryLoader` `resolvedShared` mappings must point to absolute files inside named, installed packages. The module stores them as package-relative descriptors so standalone output does not retain build-machine paths; app-local file mappings fail during setup with an actionable error.

Rspack SSR leaves `vue` and `vue/server-renderer` as native package imports so the host renderer and remote components use one runtime. Browser federation sharing is unchanged. Keep Nuxt's default `experimental.externalVue: true`; disabling it with shared Vue SSR produces a setup error. Custom Vue implementations, `singleton: false`, and configurations that omit Vue sharing opt out of this normalization.

## Deployment contract

Deploy the complete Nuxt output. By default, a remote serves:

- `/remoteEntry.js`: browser remote entry
- `/remoteEntry.ssr.js`: server remote entry
- `/mf-manifest.json`: federation manifest
- `/<buildAssetsDir>/**`: Nuxt and federation chunks referenced by the entries (`/_nuxt/**` by default)

The module adds permissive CORS headers to federation and Nuxt asset routes. Put all of these routes behind the same public origin and do not rewrite one without the others.

The host must be able to reach the remote from both environments:

- Browsers need the configured public remote URL.
- The deployed Nuxt server needs network access to the same remote URL during SSR.

Remote SSR executes the remote's server entry with the host process's privileges. Configure only trusted remotes and use a direct HTTPS URL in production. MF Vite rejects redirects and permits plain HTTP only for loopback development addresses. Its server-graph fetches do not use Module Federation runtime fetch hooks, so authenticated headers, mTLS adapters, and custom proxy fetch functions are not currently supported; expose a direct trusted endpoint or set `ssr: false`.

Give each Node process an isolated writable working directory/cache. Do not run PM2 or cluster workers against one shared `node_modules/.ssr-cache`; one exiting worker can remove files used by another. Container replicas with separate filesystems are safe. Recycle exceptionally long-lived processes after many remote deployments because old fetched graphs and Node ESM modules remain resident until process exit.

For immutable releases, deploy the remote before deploying a host that references it. Keep older remote assets available while existing browser sessions still reference them.

## Options

Configure these values under `moduleFederation` in `nuxt.config.ts`.

| Option                   | Type                       | Default                  | Description                                                                                            |
| ------------------------ | -------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `base`                   | `string`                   | `"/"`                    | Public route and output directory for federation entries and the manifest.                             |
| `exposedDir`             | `string`                   | `"~/components/exposed"` | Directory whose Nuxt components are exposed automatically.                                             |
| `manifestFetchTimeoutMs` | `number`                   | `500`                    | Maximum setup time for fetching each remote manifest.                                                  |
| `manifestMetadata`       | `Record<string, unknown>`  | `{}`                     | Values merged into `metaData.custom` in generated manifest and stats files.                            |
| `remoteComponents`       | `Record<string, string[]>` | `{}`                     | Component exposes to register when manifest discovery is unavailable or disabled.                      |
| `ssr`                    | `boolean`                  | `true`                   | Render consumed remote components on the Nuxt server. Server exposes are still published when `false`. |
| `ssrFetchTimeoutMs`      | `number`                   | `10000`                  | Maximum time for each SSR remote network request; `0` disables the timeout.                            |
| `ssrManifestMaxAgeMs`    | `number`                   | `30000`                  | Interval before the server re-checks a remote manifest for a new release.                              |
| `config`                 | `FederationOptions`        | See below                | Common federation options plus additional Rspack options, passed to the selected builder adapter.      |

The shared configuration defaults are:

```ts
{
  name: "remote",
  filename: "remoteEntry.js",
  manifest: { fileName: "mf-manifest.json" },
  dts: false, // see "Component types"
  remotes: {},
  exposes: {},
}
```

The module owns environment-specific runtime targets. Vite uses one plugin across its client and server environments; Rspack registers a separate federation plugin for each compiler. Rspack also owns server entry format, eager server shares, and client runtime extraction so remote entries can initialize independently of the remote Nuxt page. Setting `config.manifest` to `false` disables the app's manifest output, remote manifest-based component discovery, and automatic detection of new SSR builds; configure `remoteComponents` on every host and restart long-lived hosts after remote deployments in that case. Direct `remoteEntry.js` consumption remains supported.

## Verify an application

Build both the remote and host before testing the production SSR path:

```bash
pnpm typecheck
pnpm build
pnpm preview
```

Check the host response source for remote markup before JavaScript hydration, then test remote interactions in a browser. Also verify that the manifest, both remote entries, and referenced `/_nuxt` assets return successful responses from the deployed origin.
