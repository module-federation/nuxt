// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  modules: ["@pinia/nuxt", "@module-federation/nuxt"],
  vite: {
    server: {
      hmr: {
        port: 24673,
      },
    },
  },

  moduleFederation: {
    config: {
      name: "host",
      hostInitInjectLocation: "entry",
      remotes: {
        remote: {
          type: "module",
          name: "remote",
          entry: `http://localhost:4174/_mf/remoteEntry.js`,
          entryGlobalName: "remote",
          shareScope: "default",
        },
      },
    },
  },
});
