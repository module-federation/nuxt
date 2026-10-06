---
"@module-federation/nuxt": patch
---

Publish types for exposed Vue components when `nuxt build` runs after `nuxt prepare`, `nuxt dev`, or `nuxt typecheck`. Nuxt then builds into `node_modules/.cache/nuxt/.nuxt`, where TypeScript skipped the exposed SFCs and `@mf-types.zip` shipped without them.
