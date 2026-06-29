import type { ModuleFederationOptions } from "@module-federation/vite";

export const DEFAULT_BASE = "/_mf";
export const DEFAULT_EXPOSED_DIR = "~/components/exposed";
export const REMOTE_ENTRY_ASSETS = [
  "remoteEntry.js",
  "remoteEntry.ssr.js",
  "mf-manifest.json",
] as const;

export interface ModuleOptions {
  base?: string;
  exposedDir?: string;
  config?: Partial<ModuleFederationOptions>;
}

export const defaultModuleOptions = {
  base: DEFAULT_BASE,
  exposedDir: DEFAULT_EXPOSED_DIR,
  config: {
    remotes: {},
    shared: {
      // TODO: confirm heuristic for versions - based on package.json
      vue: { singleton: true, requiredVersion: "3.5.29" },
      "vue-router": { singleton: true, requiredVersion: "4.6.4" },
    },
    exposes: {},
  },
} satisfies ModuleOptions;

export function normalizeBase(base = DEFAULT_BASE) {
  return base.replace(/^\/?/, "/");
}
