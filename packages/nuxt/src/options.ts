import type { ModuleFederationOptions } from "@module-federation/vite";

export const DEFAULT_BASE = "/_mf";
export const DEFAULT_EXPOSED_DIR = "~/components/exposed";
export const DEFAULT_MANIFEST_FETCH_TIMEOUT_MS = 500;

export interface ModuleOptions {
  base?: string;
  exposedDir?: string;
  manifestFetchTimeoutMs?: number;
  manifestMetadata?: Record<string, unknown>;
  remoteComponents?: Record<string, string[]>;
  config?: Partial<ModuleFederationOptions>;
}

export const defaultModuleOptions = {
  base: DEFAULT_BASE,
  exposedDir: DEFAULT_EXPOSED_DIR,
  manifestFetchTimeoutMs: DEFAULT_MANIFEST_FETCH_TIMEOUT_MS,
  config: {
    remotes: {},
    exposes: {},
  },
} satisfies ModuleOptions;

export function normalizeBase(base = DEFAULT_BASE) {
  return base.replace(/^\/?/, "/");
}
