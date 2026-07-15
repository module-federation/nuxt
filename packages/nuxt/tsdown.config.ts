import { builtinModules } from "node:module";
import { defineConfig } from "tsdown";

const external = [
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
  "@module-federation/vite",
  "@module-federation/vite/*",
  "@nuxt/kit",
  "@nuxt/kit/*",
];

export default defineConfig({
  clean: true,
  deps: {
    neverBundle: external,
  },
  dts: {
    sourcemap: true,
  },
  entry: {
    federation: "./federation.ts",
    "shared-strategy": "./src/runtime/shared-strategy.ts",
    "ssr-entry-loader": "./src/runtime/ssr-entry-loader.ts",
  },
  format: ["esm"],
  outDir: "dist",
  sourcemap: true,
});
