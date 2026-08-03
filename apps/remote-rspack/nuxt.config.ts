import { fileURLToPath } from "node:url";

const exposedDir = fileURLToPath(
  new URL("../remote/app/components/exposed", import.meta.url),
);

export default defineNuxtConfig({
  extends: ["../remote"],
  builder: "rspack",
  app: {
    buildAssetsDir: "/rspack-remote-assets/",
  },
  moduleFederation: {
    base: "/rspack-remote-mf",
    exposedDir,
    config: {
      name: "remote",
    },
  },
});
