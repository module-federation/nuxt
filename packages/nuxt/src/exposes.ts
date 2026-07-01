import { resolveAlias, type useNuxt } from "@nuxt/kit";
import { existsSync } from "node:fs";
import { DEFAULT_EXPOSED_DIR } from "./options";

type Nuxt = ReturnType<typeof useNuxt>;

export function resolveExposedDir(
  nuxt: Nuxt,
  exposedDir = DEFAULT_EXPOSED_DIR,
) {
  return resolveAlias(exposedDir, nuxt.options.alias).replace(/\/?$/, "/");
}

export function registerExposedComponents(nuxt: Nuxt, exposedDir: string) {
  const exposed: Record<string, string> = {};

  nuxt.hook("components:dirs", (dirs) => {
    if (!existsSync(exposedDir)) return;

    dirs.unshift({
      path: exposedDir,
      pathPrefix: false,
    });
  });

  nuxt.hook("components:extend", (components) => {
    for (const component of components) {
      if (!component.filePath.startsWith(exposedDir)) continue;

      exposed[`./${component.pascalName}`] = component.filePath;
    }
  });

  return exposed;
}
