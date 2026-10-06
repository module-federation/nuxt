import { fileURLToPath } from "node:url";

const exposedDir = fileURLToPath(
  new URL("../remote/app/components/exposed", import.meta.url),
);

export default defineNuxtConfig({
  extends: ["../remote"],
  builder: "rspack",
  srcDir: "../remote/app",
  app: {
    buildAssetsDir: "/rspack-remote-assets/",
  },
  moduleFederation: {
    base: "/rspack-remote-mf",
    exposedDir,
    config: {
      name: "remote",
      // MF type generation is configured for the Vite examples only.
      dts: false,
      exposes: {
        "./bridge/export-app": fileURLToPath(
          new URL("../remote/app/export-app.ts", import.meta.url),
        ),
      },
    },
  },
});
