// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
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
    remoteComponents: {
      remote: ["Counter", "Widget"],
    },
    config: {
      name: "host",
      hostInitInjectLocation: "entry",
      remotes: {
        remote: {
          type: "module",
          name: "remote",
          entry: "http://localhost:4174/mf-manifest.json",
          entryGlobalName: "remote",
          shareScope: "default",
        },
      },
    },
  },
});
