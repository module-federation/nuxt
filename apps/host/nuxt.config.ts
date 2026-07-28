// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  ...(process.env.NUXT_MF_OUTPUT_DIR
    ? { nitro: { output: { dir: process.env.NUXT_MF_OUTPUT_DIR } } }
    : {}),
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  experimental: {
    viteEnvironmentApi: true,
  },
  modules: ["@module-federation/nuxt"],
  vite: {
    server: {
      ws: {
        port: 24673,
      },
    },
  },

  moduleFederation: {
    ssr: process.env.NUXT_MF_REMOTE_SSR !== "false",
    remoteComponents: {
      remote: ["Counter", "Widget"],
    },
    config: {
      name: "host",
      hostInitInjectLocation: "entry",
      ...(process.env.NUXT_MF_REMOTE_ONLY_SHARED === "true"
        ? {
            shared: {
              "remote-provided-package": { import: false },
            },
          }
        : {}),
      remotes: {
        remote: {
          type: "module",
          name: "remote",
          entry:
            process.env.NUXT_MF_REMOTE_URL ||
            "http://localhost:4174/_mf/mf-manifest.json",
          entryGlobalName: "remote",
          shareScope: "default",
        },
      },
    },
  },
});
