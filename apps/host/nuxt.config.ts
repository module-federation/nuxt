// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  ...(process.env.NUXT_MF_OUTPUT_DIR
    ? { nitro: { output: { dir: process.env.NUXT_MF_OUTPUT_DIR } } }
    : {}),
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  // Keep Nuxt's Vue Router provider active for the shared-symbol fixture.
  pages: true,
  experimental: {
    // Regression fixture for Nuxt's shared Vite Environment API config.
    viteEnvironmentApi: true,
  },
  modules: ["@pinia/nuxt", "@module-federation/nuxt"],
  vite: {
    server: {
      hmr: {
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
      // Regression fixture: Nuxt must still select the Node target for SSR.
      target: "web",
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
          entry: `http://localhost:4174/_mf/mf-manifest.json`,
          entryGlobalName: "remote",
          shareScope: "default",
        },
      },
    },
  },
});
