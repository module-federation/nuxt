import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

export function readNuxtViteBuilderVersion(rootDir: string) {
  try {
    const appRequire = createRequire(resolve(rootDir, "package.json"));
    const nuxtRequire = createRequire(appRequire.resolve("nuxt/package.json"));
    const viteBuilderRequire = createRequire(
      nuxtRequire.resolve("@nuxt/vite-builder"),
    );
    const packageJsonPath = viteBuilderRequire.resolve("vite/package.json");
    const packageJson: unknown = JSON.parse(
      readFileSync(packageJsonPath, "utf8"),
    );

    if (
      typeof packageJson === "object" &&
      packageJson !== null &&
      "version" in packageJson &&
      typeof packageJson.version === "string"
    ) {
      return packageJson.version;
    }
  } catch {
    return undefined;
  }

  return undefined;
}
