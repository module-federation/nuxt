# @module-federation/nuxt

## 0.2.0

### Minor Changes

- e3883c4: Support Nuxt's Rspack builder alongside Vite, including cross-builder remote loading, server rendering, and browser hydration. Preserve direct remote asset origins and validate both builders in development and production.
- 582f72a: Type remote components from Module Federation `dts` output. With `config.dts` enabled, remotes publish `@mf-types.zip` from Nuxt's tsconfig with `vue-tsc`, and hosts resolve `RemoteX` components and `remote/X` imports from the downloaded `@mf-types`, falling back to `Component` when types are unavailable.

### Patch Changes

- e3883c4: Skip remote manifest discovery when `config.manifest` is `false` and use configured `remoteComponents` only.
- e3883c4: Rebase production manifest shared asset URLs relative to the published federation manifest.
- e3883c4: Refresh stable SSR manifest redirects so newly deployed remote releases are discovered.
- e3883c4: Retry SSR manifest redirect probes after HTTP errors or incomplete redirects instead of caching the original URL as a direct manifest.
- e3883c4: Retry stable SSR manifest redirect discovery after a transient probe failure.
- e3883c4: Publish federation manifests and remote entries at root URLs by default.
- e3883c4: Resolve shared runtime imports in Vite 8 SSR builds.

## 0.1.0

### Minor Changes

- 3cd2bd1: Harden Nuxt Module Federation for its first production release: portable SSR remote loading, retryable outage fallbacks, Vue singleton sharing, current MF Vite runtime support, and complete package documentation.
