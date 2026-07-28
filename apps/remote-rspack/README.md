# Rspack remote

Nuxt Rspack remote at `http://localhost:4176`.

Federation assets use `/rspack-remote-mf`; compiled browser chunks and the portable SSR graph use `/rspack-remote-assets`. The Rspack host proxies both paths for same-origin development loading.

Run the Rspack pair from the repository root:

```bash
pnpm dev:rspack
```
