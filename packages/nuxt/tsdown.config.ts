import { builtinModules } from "node:module";
import { defineConfig } from "tsdown";

const external = [
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
  "@module-federation/runtime",
  "@module-federation/runtime/*",
  "@module-federation/vite",
  "@module-federation/vite/*",
  "@module-federation/enhanced",
  "@module-federation/enhanced/*",
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
    "rspack-vite-loader": "./src/runtime/rspack-vite-loader.ts",
    "rspack-remotes": "./src/runtime/rspack-remotes.ts",
    "rspack-hmr-loader": "./src/runtime/rspack-hmr-loader.ts",
  },
  format: ["esm"],
  outDir: "dist",
  sourcemap: true,
});
