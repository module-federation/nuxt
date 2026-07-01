import type { HookResult, Nuxt } from "@nuxt/schema";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { ModuleOptions } from "./options";

type NitroPublicAssetsContext = {
  options: {
    buildDir: string;
    output: {
      publicDir: string;
    };
  };
};

declare module "@nuxt/schema" {
  interface NuxtHooks {
    "nitro:build:public-assets": (
      nitro: NitroPublicAssetsContext,
    ) => HookResult;
  }
}

export function registerRemoteEntryAssetCopy(
  nuxt: Nuxt,
  publicBase: string,
  options: ModuleOptions,
) {
  const outputBase = publicBase.replace(/^\//, "");
  const remoteEntryFiles = resolveRemoteEntryFiles(options);

  // Nuxt only copies the _nuxt/ subfolder from dist/client/ to .output/public/.
  // Federation entries are moved under publicBase, so their root-relative chunk
  // imports must be rebased back to Nuxt's public _nuxt/ directory.
  nuxt.hook("nitro:build:public-assets", (nitro) => {
    for (const file of remoteEntryFiles) {
      const src = resolve(nitro.options.buildDir, `dist/client/${file}`);
      const dest = resolve(nitro.options.output.publicDir, outputBase, file);

      if (existsSync(src)) {
        ensureParentDir(dest);

        if (shouldRebaseNuxtClientImports(file, outputBase)) {
          writeFileSync(
            dest,
            rebaseNuxtClientImports(
              readFileSync(src, "utf8"),
              outputBase,
              file,
            ),
          );
        } else {
          cpSync(src, dest);
        }
      }
    }
  });
}

function resolveRemoteEntryFiles(options: ModuleOptions) {
  const remoteEntry = resolveRemoteEntryFileName(options);

  return [
    remoteEntry,
    resolveSsrRemoteEntryFileName(remoteEntry),
    resolveManifestFileName(options),
  ];
}

function resolveRemoteEntryFileName(options: ModuleOptions) {
  return typeof options.config?.filename === "string"
    ? options.config.filename
    : "remoteEntry.js";
}

function resolveSsrRemoteEntryFileName(remoteEntry: string) {
  const dotIndex = remoteEntry.lastIndexOf(".");

  if (dotIndex === -1) return `${remoteEntry}.ssr.js`;

  return `${remoteEntry.slice(0, dotIndex)}.ssr${remoteEntry.slice(dotIndex)}`;
}

function resolveManifestFileName(options: ModuleOptions) {
  if (
    options.config?.manifest &&
    typeof options.config.manifest !== "boolean"
  ) {
    return options.config.manifest.fileName || "mf-manifest.json";
  }

  return "mf-manifest.json";
}

function ensureParentDir(path: string) {
  mkdirSync(dirname(path), { recursive: true });
}

function shouldRebaseNuxtClientImports(file: string, outputBase: string) {
  return (
    outputBase.length > 0 && (file.endsWith(".js") || file.endsWith(".mjs"))
  );
}

function rebaseNuxtClientImports(
  source: string,
  outputBase: string,
  file: string,
) {
  const depth = [outputBase, dirname(file)]
    .flatMap((path) => path.split("/"))
    .filter((part) => part && part !== ".").length;
  const prefix = "../".repeat(depth);

  return source.replace(/(["'`])\.\/_nuxt\//g, `$1${prefix}_nuxt/`);
}
