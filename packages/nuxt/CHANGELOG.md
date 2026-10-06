# @module-federation/nuxt

## [0.2.0](https://github.com/module-federation/nuxt/compare/0.1.0...0.2.0) (2026-10-06)


### Features

* **examples:** expose Bridge export-app from Nuxt remote ([#21](https://github.com/module-federation/nuxt/issues/21)) ([c4d1ae8](https://github.com/module-federation/nuxt/commit/c4d1ae82aff72aa1718f9ccdc18c8e39f7923db5))
* **nuxt:** support Vite and Rspack federation ([#23](https://github.com/module-federation/nuxt/issues/23)) ([a6eb568](https://github.com/module-federation/nuxt/commit/a6eb56873cae911fc428fad83a4014be9ef67141))


### Bug Fixes

* **nuxt:** resolve Vite 8 SSR shared runtime imports ([#25](https://github.com/module-federation/nuxt/issues/25)) ([a5be5bd](https://github.com/module-federation/nuxt/commit/a5be5bd6390b8fbae569d50a72c1d56b14290bdb))
* **nuxt:** skip remote manifest discovery when config.manifest is false ([#17](https://github.com/module-federation/nuxt/issues/17)) ([99fce02](https://github.com/module-federation/nuxt/commit/99fce0227e6eb3d68aa1087f091ca0a4badb6143))
* publish federation assets at root ([#11](https://github.com/module-federation/nuxt/issues/11)) ([6ec10a3](https://github.com/module-federation/nuxt/commit/6ec10a39c82104ba6b96a8d7d3e0f58db9420e27))
* rebase shared asset paths in production manifests ([#9](https://github.com/module-federation/nuxt/issues/9)) ([db4f39f](https://github.com/module-federation/nuxt/commit/db4f39fcd20eafde13dca80f3adc1f9d4db3212b))
* Refresh stable SSR manifest redirects ([#12](https://github.com/module-federation/nuxt/issues/12)) ([a590123](https://github.com/module-federation/nuxt/commit/a59012329bde9bb1143c9e8c15e99f7a24456ea5))
* Retry failed SSR manifest redirect probes ([#13](https://github.com/module-federation/nuxt/issues/13)) ([52aac80](https://github.com/module-federation/nuxt/commit/52aac80db9fb1c943885479fc68377708f2e0a0e))
* retry SSR redirect probes after HTTP errors ([#16](https://github.com/module-federation/nuxt/issues/16)) ([5c1e30d](https://github.com/module-federation/nuxt/commit/5c1e30d7a830183749357e4479517f92ca6a11fd))
* validate import-false SSR shared dependencies ([#18](https://github.com/module-federation/nuxt/issues/18)) ([6f145fb](https://github.com/module-federation/nuxt/commit/6f145fb8b85be27858678029183495d51640521c))

## 0.1.0

### Minor Changes

- 3cd2bd1: Harden Nuxt Module Federation for its first production release: portable SSR remote loading, retryable outage fallbacks, Vue singleton sharing, current MF Vite runtime support, and complete package documentation.
