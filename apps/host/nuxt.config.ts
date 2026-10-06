import { fileURLToPath } from "node:url";

const isDev = process.env.NODE_ENV !== "production";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  modules: ["@pinia/nuxt", "@module-federation/nuxt"],
  experimental: {
    buildCache: false,
  },

  hooks: {
    // Vue Router catch-all name so bridge-vue3 basename auto-detect works
    // without waiting for explicit-basename releases.
    "pages:extend"(pages) {
      pages.push({
        name: "bridge-remote",
        path: "/bridge/:pathMatch(.*)*",
        file: "~/components/BridgeRemotePage.vue",
      });
    },
  },

  moduleFederation: {
    remoteComponents: {
      remote: ["Widget", "Counter"],
    },
    config: {
      name: "host",
      hostInitInjectLocation: "entry",
      runtimePlugins: [
        fileURLToPath(
          new URL("./federation-browser-origin.ts", import.meta.url),
        ),
      ],
      remotes: {
        remote: {
          type: "module",
          name: "remote",
          entry: isDev
            ? "http://localhost:4174/remoteEntry.js"
            : "http://localhost:4174/mf-manifest.json",
          entryGlobalName: "remote",
          shareScope: "default",
        },
      },
    },
  },
});
