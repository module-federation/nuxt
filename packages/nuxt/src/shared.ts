import type { ModuleFederationOptions } from "@module-federation/vite";
import { type useNuxt } from "@nuxt/kit";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseJsonObject, readString, readStringRecord } from "./json";

type Nuxt = ReturnType<typeof useNuxt>;
type SharedConfig = NonNullable<ModuleFederationOptions["shared"]>;

const DEFAULT_SHARED_PACKAGES = ["vue", "vue-router"] as const;

export function resolveSharedConfig(
  nuxt: Nuxt,
  configuredShared: ModuleFederationOptions["shared"],
): SharedConfig {
  if (configuredShared) return configuredShared;

  return Object.fromEntries(
    DEFAULT_SHARED_PACKAGES.map((packageName) => {
      const version = resolvePackageVersion(nuxt.options.rootDir, packageName);

      return [
        packageName,
        {
          singleton: true,
          ...(version ? { requiredVersion: version } : {}),
        },
      ];
    }),
  );
}

function resolvePackageVersion(rootDir: string, packageName: string) {
  const installedVersion = readInstalledPackageVersion(rootDir, packageName);
  if (installedVersion) return installedVersion;

  return readDeclaredPackageVersion(rootDir, packageName);
}

function readInstalledPackageVersion(rootDir: string, packageName: string) {
  try {
    const require = createRequire(resolve(rootDir, "package.json"));
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    const packageJson = parseJsonObject(readFileSync(packageJsonPath, "utf8"));

    return packageJson ? readString(packageJson, "version") : undefined;
  } catch {
    return undefined;
  }
}

function readDeclaredPackageVersion(rootDir: string, packageName: string) {
  const packageJsonPath = resolve(rootDir, "package.json");
  if (!existsSync(packageJsonPath)) return undefined;

  const packageJson = parseJsonObject(readFileSync(packageJsonPath, "utf8"));
  if (!packageJson) return undefined;

  const dependencies = readStringRecord(packageJson, "dependencies");
  const devDependencies = readStringRecord(packageJson, "devDependencies");
  const peerDependencies = readStringRecord(packageJson, "peerDependencies");

  return (
    dependencies?.[packageName] ||
    devDependencies?.[packageName] ||
    peerDependencies?.[packageName]
  );
}
