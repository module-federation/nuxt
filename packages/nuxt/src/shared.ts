import type { ModuleFederationOptions } from "@module-federation/vite";
import { useLogger, type useNuxt } from "@nuxt/kit";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { isJsonObject, parseJsonObject, readString, readStringRecord } from "./json";
import type { RemoteSharedInfo } from "./remotes";

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

export function getSharedPackageNames(
  shared: ModuleFederationOptions["shared"] | undefined,
) {
  if (Array.isArray(shared)) return new Set(shared);
  if (isJsonObject(shared)) return new Set(Object.keys(shared));

  return new Set<string>();
}

/**
 * The Vite server-side federation build has no share scope (shared modules
 * are aliased to the host's installed copies), so version mismatches with a
 * remote are never negotiated at runtime. Surface them at build time instead.
 */
export function warnOnSharedVersionMismatches(
  nuxt: Nuxt,
  shared: ModuleFederationOptions["shared"] | undefined,
  remoteShared: Record<string, RemoteSharedInfo[]>,
) {
  const logger = useLogger("module-federation");
  const hostVersions = new Map<string, string>();

  for (const packageName of getSharedPackageNames(shared)) {
    const version = resolvePackageVersion(nuxt.options.rootDir, packageName);
    if (version) hostVersions.set(packageName, version);
  }

  for (const [remoteName, entries] of Object.entries(remoteShared)) {
    for (const entry of entries) {
      const hostVersion = hostVersions.get(entry.name);
      if (!hostVersion || !entry.version || hostVersion === entry.version) {
        continue;
      }

      const message =
        `Shared dependency "${entry.name}" differs between host (${hostVersion}) ` +
        `and remote "${remoteName}" (${entry.version}). During SSR the host's ` +
        `copy is used without version negotiation.`;

      if (majorVersion(hostVersion) !== majorVersion(entry.version)) {
        logger.warn(message);
      } else {
        logger.info(message);
      }
    }
  }
}

function majorVersion(version: string) {
  return version.match(/\d+/)?.[0];
}

function resolvePackageVersion(rootDir: string, packageName: string) {
  const installedVersion = readInstalledPackageVersion(rootDir, packageName);
  if (installedVersion) return installedVersion;

  return readDeclaredPackageVersion(rootDir, packageName);
}

export function readInstalledPackageVersion(
  rootDir: string,
  packageName: string,
) {
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
