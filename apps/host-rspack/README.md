# Rspack host

Nuxt Rspack host at `http://localhost:4175`. It server-renders the remote components, then hydrates them with the browser entry.

The host proxies the remote federation routes through its own origin because Nuxt's Rspack development middleware only serves same-origin requests.

Run the Rspack pair from the repository root:

```bash
pnpm dev:rspack
```
