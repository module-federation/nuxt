import type { ModuleFederationOptions } from "@module-federation/vite";

export const DEFAULT_BASE = "/_mf";
export const DEFAULT_EXPOSED_DIR = "~/components/exposed";
export const DEFAULT_MANIFEST_FETCH_TIMEOUT_MS = 500;
export const DEFAULT_SSR_FETCH_TIMEOUT_MS = 10_000;
export const DEFAULT_SSR_MANIFEST_MAX_AGE_MS = 30_000;

export interface ModuleOptions {
  base?: string;
  exposedDir?: string;
  manifestFetchTimeoutMs?: number;
  manifestMetadata?: Record<string, unknown>;
  remoteComponents?: Record<string, string[]>;
  /** Maximum time for each production SSR remote request. Set to 0 to disable. */
  ssrFetchTimeoutMs?: number;
  /** Re-check remote manifests after this interval while the server is running. */
  ssrManifestMaxAgeMs?: number;
  /**
   * Render remote components during SSR and load their server-side remote
   * entries at runtime. Enabled by default in both dev and production so the
   * server-rendered markup matches across environments. Set to false to fall
   * back to client-only rendering of remote components.
   */
  ssr?: boolean;
  config?: Partial<ModuleFederationOptions>;
}

export const defaultModuleOptions = {
  base: DEFAULT_BASE,
  exposedDir: DEFAULT_EXPOSED_DIR,
  manifestFetchTimeoutMs: DEFAULT_MANIFEST_FETCH_TIMEOUT_MS,
  ssrFetchTimeoutMs: DEFAULT_SSR_FETCH_TIMEOUT_MS,
  ssrManifestMaxAgeMs: DEFAULT_SSR_MANIFEST_MAX_AGE_MS,
  ssr: true,
  config: {
    remotes: {},
    exposes: {},
  },
} satisfies ModuleOptions;

export function normalizeBase(base = DEFAULT_BASE) {
  return `/${base}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}
