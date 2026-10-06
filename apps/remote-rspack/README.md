# Rspack remote

Nuxt Rspack remote at `http://localhost:4176`.

Federation assets use `/rspack-remote-mf`; compiled browser chunks and the portable SSR graph use `/rspack-remote-assets`. Hosts load both paths directly from the remote origin in development and production.

Run the Rspack pair from the repository root:

```bash
pnpm dev:rspack
```
