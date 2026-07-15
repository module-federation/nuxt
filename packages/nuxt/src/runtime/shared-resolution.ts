import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export interface PortableSharedResolution {
  packageName: string;
  packagePath: string;
  packageVersion?: string;
}

export function resolveRuntimeShared(
  packageNames: string[],
  runtimeRequires: NodeJS.Require[],
) {
  const resolved: Record<string, string> = {};

  for (const packageName of packageNames) {
    for (const require of runtimeRequires) {
      try {
        resolved[packageName] = require.resolve(packageName);
        break;
      } catch {
        // Try the next runtime-relative resolver.
      }
    }
  }

  return resolved;
}

export function resolvePortableShared(
  mappings: Record<string, PortableSharedResolution>,
  runtimeRequires: NodeJS.Require[],
) {
  const resolved: Record<string, string> = {};

  for (const [specifier, mapping] of Object.entries(mappings)) {
    const packageFile = resolvePortablePackageFile(mapping, runtimeRequires);
    if (!packageFile) {
      const version = mapping.packageVersion
        ? `@${mapping.packageVersion}`
        : "";
      throw new Error(
        `[module-federation] Cannot resolve portable shared mapping "${specifier}" to ${mapping.packageName}${version}/${mapping.packagePath} in the deployed server.`,
      );
    }
    resolved[specifier] = packageFile;
  }

  return resolved;
}

function resolvePortablePackageFile(
  mapping: PortableSharedResolution,
  runtimeRequires: NodeJS.Require[],
) {
  const packageRoots = new Set<string>();

  for (const require of runtimeRequires) {
    for (const searchPath of require.resolve.paths(mapping.packageName) || []) {
      packageRoots.add(resolve(searchPath, mapping.packageName));
    }

    try {
      const packageEntry = require.resolve(mapping.packageName);
      const packageRoot = findPackageRoot(packageEntry, mapping);
      if (packageRoot) packageRoots.add(packageRoot);
    } catch {
      // Packages without a root export are still found through resolve.paths.
    }
  }

  for (const packageRoot of packageRoots) {
    if (!matchesPackage(packageRoot, mapping)) continue;

    const packageFile = resolve(packageRoot, mapping.packagePath);
    const packageRelativePath = relative(packageRoot, packageFile);
    if (!isContainedPath(packageRelativePath) || !existsSync(packageFile)) {
      continue;
    }

    return packageFile;
  }
}

function findPackageRoot(
  packageEntry: string,
  mapping: PortableSharedResolution,
) {
  let directory = dirname(packageEntry);

  while (true) {
    if (matchesPackage(directory, mapping)) return directory;

    const parent = dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}

function matchesPackage(
  packageRoot: string,
  mapping: PortableSharedResolution,
) {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(resolve(packageRoot, "package.json"), "utf8"),
    );
    if (!isRecord(parsed) || parsed.name !== mapping.packageName) return false;

    return !mapping.packageVersion || parsed.version === mapping.packageVersion;
  } catch {
    return false;
  }
}

function isContainedPath(path: string) {
  return Boolean(
    path && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
