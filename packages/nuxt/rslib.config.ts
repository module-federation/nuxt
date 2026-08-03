import { defineConfig } from "@rslib/core";
import { builtinModules } from "node:module";

const external = [
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
  /^@module-federation\/(?:.*)$/,
  /^@nuxt\/(?:.*)$/,
  "acorn",
];

const entries = {
  federation: "./federation.ts",
  "rspack-vite-loader": "./src/runtime/rspack-vite-loader.ts",
  "shared-strategy": "./src/runtime/shared-strategy.ts",
  "ssr-entry-loader": "./src/runtime/ssr-entry-loader.ts",
};

export default defineConfig({
  lib: Object.entries(entries).map(([id, entry]) => ({
    autoExternal: false,
    dts: {
      autoExtension: true,
    },
    format: "esm",
    id,
    outBase: id === "federation" ? "." : "./src/runtime",
    source: {
      entry: {
        [id]: entry,
      },
      tsconfigPath:
        id === "federation" ? "./tsconfig.json" : "./tsconfig.runtime.json",
    },
  })),
  output: {
    cleanDistPath: true,
    externals: external,
    filename: {
      js: "[name].mjs",
    },
    sourceMap: true,
  },
});
