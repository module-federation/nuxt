import { type useNuxt } from "@nuxt/kit";
import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { REMOTE_ENTRY_ASSETS } from "./options";

type Nuxt = ReturnType<typeof useNuxt>;

export function registerRemoteEntryAssetCopy(nuxt: Nuxt, publicBase: string) {
  const outputBase = publicBase.replace(/^\//, "");

  // Nuxt only copies the _nuxt/ subfolder from dist/client/ to .output/public/.
  // The federation plugin emits remoteEntry.js at the output root, where its
  // relative imports like "./_nuxt/chunk.js" resolve correctly.
  nuxt.hook("nitro:build:public-assets", (nitro) => {
    for (const file of REMOTE_ENTRY_ASSETS) {
      const src = resolve(nitro.options.buildDir, `dist/client/${file}`);
      const dest = resolve(nitro.options.output.publicDir, outputBase, file);

      if (existsSync(src)) {
        cpSync(src, dest);
      }
    }
  });
}
