# Nuxt builder integration

The module selects its adapter from `nuxt.options.builder`. The default Vite builder uses `@module-federation/vite`; `rspack` and its normalized name, `@nuxt/rspack-builder`, use `@module-federation/enhanced/rspack`. A package build made with Rspack would not establish Nuxt Rspack support. The application client and server compilers must both install federation.

The integration is pinned and tested with Nuxt and its Rspack builder at `4.5.1`, MF Vite at `1.20.0`, and MF Enhanced at `2.8.1`. Nuxt's builder resolves Rspack `2.1.10` in the lockfile. Keep the Nuxt builder version aligned with Nuxt when upgrading. The package itself continues to build with tsdown.

## Shared responsibilities

Both adapters use the same Nuxt component discovery, remote component wrappers, shared dependency defaults, public entry routes, and SSR recovery loader. A host can consume either builder's manifest. The manifest identifies the browser entry type and the ESM server entry; assuming every browser entry is ESM would break Rspack's global container.

The public remote object format is the MF Vite format, including `name`, `entry`, `type`, `entryGlobalName`, and `shareScope`. The Rspack adapter converts it to native `name@entry` externals and restores the entry type through a runtime plugin. Named string remotes are also accepted. Builder-specific options remain builder-specific; this module does not promise identical behavior for every upstream plugin option.

Production remote SSR requires a writable Node deployment. The common loader downloads the portable ESM graph to its cache, resolves framework dependencies from the host deployment, retries failed loads, and checks manifest fingerprints for new remote builds. Both adapters validate host-provided `import: false` shared dependencies before enabling SSR remote loading.

## Vite

Nuxt 4.5 uses Vite 8 and Rolldown. One federation plugin participates in both environments to avoid overwriting MF Vite's process-level shared configuration. The module owns the runtime target for each environment and publishes exposed Vue components from the actual server graph. This preserves Nuxt's server transforms and bare singleton imports.

## Rspack

Nuxt exposes separate client and server configurations through `addRspackPlugin` and `extendRspackConfig`. The adapter installs federation in each compiler. The browser entry contains its own runtime, so a host can initialize it without loading the remote's Nuxt page first. Automatic public paths resolve against the remote origin and point at Nuxt's build-assets directory. Explicit `config.publicPath` remains available for CDN deployments.

Rspack defaults the host-level share strategy to `loaded-first`. Preloading a direct Vite ESM container with `version-first` can wait on that container's shared imports before the host has finished initializing them. A per-dependency strategy alone does not prevent this startup cycle. An explicit `config.shareStrategy` still takes precedence.

The server compiler emits ESM containers using Nuxt's server Vue loader. The adapter keeps server shared dependencies eager, converts remote chunk loading into static ESM imports, and publishes the reachable SSR graph. Static imports allow the common download loader to discover every needed server chunk. The publisher rejects references to unpublished files and build-machine paths and records a fingerprint in the manifest.

Production SSR loaders retain their runtime `import.meta.url` so they can find dependencies beside the deployed server, including when an external bootstrap imports the server from another working directory. Rspack's default substitution would otherwise freeze the loader's build-machine URL. Only loader modules receive this compiler rule; application modules keep their normal behavior. Development keeps installed-package resolution because Nuxt evaluates its server bundle differently and MF Vite needs its installed ModuleRunner peer.

Nuxt 4.5's Rsbuild development middleware rejects cross-origin requests before applying its asset middleware. CORS headers alone cannot fix that. The adapter serves known emitted client assets before that guard. Unknown paths and non-asset routes continue through Nuxt's original handler. The examples use direct remote origins, without a host proxy.

The remote's HMR client must also connect to the remote origin. Nuxt does not expose Rsbuild's `dev.client` configuration, so a narrowly scoped loader adapts Rsbuild's HMR URL calculation to use the federation runtime's public path. It preserves the socket path, authentication token, and explicit client settings. This compatibility code is tied to the tested builder version and fails with an actionable error if the expected client code changes.

## Validation

Run these from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:e2e:dev
pnpm format:check
pnpm pack:nuxt
```

The browser suites run these pairs in both development and production:

| Host   | Remote | Host port |
| ------ | ------ | --------- |
| Vite   | Vite   | 4173      |
| Rspack | Rspack | 4175      |
| Vite   | Rspack | 4177      |
| Rspack | Vite   | 4178      |

Each pair checks remote markup in the HTTP response before JavaScript runs, hydration and independent counter updates, and Bridge navigation plus direct child-route reloads. Browser errors, hydration mismatches, and failed script or stylesheet requests fail the test. The two mixed hosts are temporary fixtures. The suites reject existing servers to avoid accidentally testing stale builds.

Development also edits a copied Rspack remote component and checks that a Vite host receives the hot update without reloading the document or losing host and remote counter state. Application source files are not modified by this test.

The Node tests cover published entries and reachable chunks, custom manifest and asset paths, SSR portability, missing or incompatible host shares, recovery after network failures, and cross-origin development asset requests. The Rspack deployment regression copies the complete output outside the checkout and imports it from an empty working directory, then checks remote SSR and the cache's deployed dependency path. CI builds all four example applications before running those tests; the E2E workflow runs both browser modes.

## Prior PR and upstream references

[PR #10](https://github.com/module-federation/nuxt/pull/10) introduced the Rspack adapter. Its original browser job covered only the Vite pair, and its CI build step omitted the Rspack applications required by its production tests. These gaps allowed browser runtime extraction and relative asset URLs to remain untested. This integration retains the adapter's SSR approach while preserving the newer Vite, Bridge, manifest-discovery, and shared-dependency fixes on main.

- [Nuxt 4.5.1 builder selection](https://github.com/nuxt/nuxt/blob/v4.5.1/packages/schema/src/config/build.ts)
- [Nuxt Kit build hooks](https://github.com/nuxt/nuxt/blob/v4.5.1/packages/kit/src/build.ts)
- [Nuxt compiler and dev-server lifecycle](https://github.com/nuxt/nuxt/blob/v4.5.1/packages/webpack/src/webpack.ts)
- [Nuxt development origin guard](https://github.com/nuxt/nuxt/blob/v4.5.1/packages/webpack/src/utils/same-origin.ts)
- [Module Federation Rspack integration](https://module-federation.io/guide/basic/rspack)
