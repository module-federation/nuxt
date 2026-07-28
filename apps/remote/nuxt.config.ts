// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  modules: ["@module-federation/nuxt"],
  vite: {
    server: {
      ws: {
        port: 24674,
      },
    },
  },
  moduleFederation: {
    config: { name: "remote" },
  },
});
