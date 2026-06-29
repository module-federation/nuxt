// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  modules: ["@module-federation/nuxt"],
  vite: {
    server: {
      hmr: {
        port: 24674,
      },
    },
  },
  moduleFederation: {
    config: {
      exposes: {
        "./remote-app": "./app/app.vue",
      },
    },
  },
});
