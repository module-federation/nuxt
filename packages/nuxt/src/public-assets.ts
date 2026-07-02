import type { HookResult, Nuxt } from "@nuxt/schema";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { REMOTE_ENTRY_ASSETS } from "./options";

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

export function registerRemoteEntryAssetCopy(nuxt: Nuxt, publicBase: string) {
  const outputBase = publicBase.replace(/^\//, "");

  // Nuxt only copies the _nuxt/ subfolder from dist/client/ to .output/public/.
  // Federation entries are moved under publicBase, so their root-relative chunk
  // imports must be rebased back to Nuxt's public _nuxt/ directory.
  nuxt.hook("nitro:build:public-assets", (nitro) => {
    for (const file of REMOTE_ENTRY_ASSETS) {
      const src = resolve(nitro.options.buildDir, `dist/client/${file}`);
      const dest = resolve(nitro.options.output.publicDir, outputBase, file);

      if (existsSync(src)) {
        ensureParentDir(dest);

        if (shouldRebaseNuxtClientImports(file, outputBase)) {
          writeFileSync(
            dest,
            rebaseNuxtClientImports(readFileSync(src, "utf8"), outputBase),
          );
        } else {
          cpSync(src, dest);
        }
      }
    }
  });
}

function ensureParentDir(path: string) {
  mkdirSync(dirname(path), { recursive: true });
}

function shouldRebaseNuxtClientImports(file: string, outputBase: string) {
  return (
    outputBase.length > 0 &&
    (file === "remoteEntry.js" || file === "remoteEntry.ssr.js")
  );
}

function rebaseNuxtClientImports(source: string, outputBase: string) {
  const depth = outputBase.split("/").filter(Boolean).length;
  const prefix = "../".repeat(depth);

  return source.replace(/(["'`])\.\/_nuxt\//g, `$1${prefix}_nuxt/`);
}
