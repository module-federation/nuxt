import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const SSR_ENTRY_LOADER_PLUGIN = "@module-federation/vite/ssrEntryLoader";

export interface PortableSharedResolution {
  packageName: string;
  packagePath: string;
  packageVersion?: string;
}

export interface PortableResolvedShared {
  mappings: Record<string, PortableSharedResolution>;
  traceIncludes: string[];
}

export function createSsrEntryLoaderPlugin(
  enabled: boolean,
  loaderOptions: Record<string, unknown>,
): [string, Record<string, unknown>] {
  return [
    SSR_ENTRY_LOADER_PLUGIN,
    enabled ? loaderOptions : { disabled: true },
  ];
}

export function mergeSsrRuntimePackageNames(
  configuredPackages: unknown,
  requiredPackages: string[],
) {
  return mergePackageNames(configuredPackages, requiredPackages);
}

export function mergeSsrRequiredPackageNames(
  configuredPackages: unknown,
  requiredPackages: string[],
) {
  return mergePackageNames(configuredPackages, requiredPackages);
}

export function selectSsrRuntimePackageNames(
  requiredPackages: string[],
  sharedPackages: Iterable<string>,
) {
  const shared = new Set(sharedPackages);

  return [...new Set(requiredPackages.filter((name) => !shared.has(name)))];
}

function mergePackageNames(
  configuredPackages: unknown,
  requiredPackages: string[],
) {
  const packageNames = Array.isArray(configuredPackages)
    ? configuredPackages.filter(isString)
    : [];

  return [...new Set([...packageNames, ...requiredPackages])];
}

export function createPortableResolvedShared(
  configuredResolvedShared: unknown,
  rootDir: string,
): PortableResolvedShared {
  const mappings: Record<string, PortableSharedResolution> = {};
  const traceIncludes: string[] = [];
  if (!isRecord(configuredResolvedShared)) return { mappings, traceIncludes };

  for (const [specifier, configuredPath] of Object.entries(
    configuredResolvedShared,
  )) {
    if (!isString(configuredPath)) continue;

    mappings[specifier] = createPortableSharedResolution(
      specifier,
      configuredPath,
      rootDir,
    );
    traceIncludes.push(configuredPath);
  }

  return { mappings, traceIncludes };
}

function createPortableSharedResolution(
  specifier: string,
  configuredPath: string,
  rootDir: string,
): PortableSharedResolution {
  if (!isAbsolute(configuredPath)) {
    throw unsupportedResolvedShared(specifier, configuredPath);
  }

  const normalizedRoot = resolve(rootDir);
  let packageRoot = dirname(configuredPath);

  while (true) {
    const packageInfo = readPackageInfo(packageRoot);
    if (packageInfo?.name) {
      if (resolve(packageRoot) === normalizedRoot) {
        throw unsupportedResolvedShared(specifier, configuredPath);
      }

      const packagePath = relative(packageRoot, configuredPath);
      if (!isContainedPath(packagePath)) {
        throw unsupportedResolvedShared(specifier, configuredPath);
      }

      return {
        packageName: packageInfo.name,
        packagePath: packagePath.split(sep).join("/"),
        ...(packageInfo.version ? { packageVersion: packageInfo.version } : {}),
      };
    }

    const parent = dirname(packageRoot);
    if (parent === packageRoot) break;
    packageRoot = parent;
  }

  throw unsupportedResolvedShared(specifier, configuredPath);
}

function readPackageInfo(directory: string) {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(resolve(directory, "package.json"), "utf8"),
    );
    if (!isRecord(parsed) || !isString(parsed.name)) return;

    return {
      name: parsed.name,
      version: isString(parsed.version) ? parsed.version : undefined,
    };
  } catch {
    return;
  }
}

function isContainedPath(path: string) {
  return Boolean(
    path && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path),
  );
}

function unsupportedResolvedShared(specifier: string, configuredPath: string) {
  return new Error(
    `[module-federation] Cannot make resolvedShared mapping "${specifier}" (${configuredPath}) portable. Point it to an absolute file inside an installed, named package.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
