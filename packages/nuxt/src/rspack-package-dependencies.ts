import { createRequire } from "node:module";

const packageRequire = createRequire(import.meta.url);
const runtimeRequire = createRequire(
  packageRequire.resolve("@module-federation/runtime/package.json"),
);

export function resolveRspackPackageDependency(specifier: string) {
  for (const require of [packageRequire, runtimeRequire]) {
    try {
      return require.resolve(specifier);
    } catch {}
  }

  throw new Error(
    `[module-federation] Cannot resolve package-owned Rspack dependency "${specifier}" from @module-federation/nuxt.`,
  );
}
