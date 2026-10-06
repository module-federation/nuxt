---
"@module-federation/nuxt": minor
---

Type remote components from Module Federation `dts` output. With `config.dts` enabled, remotes publish `@mf-types.zip` from Nuxt's tsconfig with `vue-tsc`, and hosts resolve `RemoteX` components and `remote/X` imports from the downloaded `@mf-types`, falling back to `Component` when types are unavailable.
