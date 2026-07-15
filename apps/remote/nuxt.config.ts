// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  ...(process.env.NUXT_MF_BUILD_DIR
    ? { buildDir: process.env.NUXT_MF_BUILD_DIR }
    : {}),
  ...(process.env.NUXT_MF_BUILD_ASSETS_DIR
    ? { app: { buildAssetsDir: process.env.NUXT_MF_BUILD_ASSETS_DIR } }
    : {}),
  ...(process.env.NUXT_MF_OUTPUT_DIR
    ? { nitro: { output: { dir: process.env.NUXT_MF_OUTPUT_DIR } } }
    : {}),
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  ssr: process.env.NUXT_MF_NUXT_SSR !== "false",
  experimental: {
    // Tests opt into the shared Vite Environment API; normal builds retain
    // coverage for Nuxt's legacy serial client/server path.
    viteEnvironmentApi: process.env.NUXT_MF_ENVIRONMENT_API === "true",
  },
  modules: ["@module-federation/nuxt"],
  vite: {
    server: {
      hmr: {
        port: 24674,
      },
    },
  },
  moduleFederation: {
    ssr: process.env.NUXT_MF_REMOTE_SSR !== "false",
    config: {
      ...(process.env.NUXT_MF_FILENAME
        ? { filename: process.env.NUXT_MF_FILENAME }
        : {}),
      exposes: {
        "./remote-app": "./app/app.vue",
      },
    },
  },
});
