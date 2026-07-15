import { getInstance } from "@module-federation/runtime";
import ssrEntryLoaderPlugin from "@module-federation/vite/ssrEntryLoader";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as vm from "node:vm";
import {
  resolvePortableShared,
  resolveRuntimeShared,
  type PortableSharedResolution,
} from "./shared-resolution";

const SSR_RUNTIME_BRIDGES = Symbol.for("@module-federation/nuxt:ssr-runtime");
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const patchedManifestFetchHooks = new WeakSet<object>();

interface PortableSsrEntryLoaderOptions {
  fetchTimeoutMs?: number;
  hostName: string;
  maxAgeMs?: number;
  portableResolvedShared?: Record<string, PortableSharedResolution>;
  requiredPackages?: string[];
  runtimePackages?: string[];
  shareScopeName?: string;
  strategy?: "temp-file" | "vm";
}

interface SsrRuntimeBridge {
  invalidate(remoteName: string): void;
  load(remoteName: string, importPath: string): Promise<unknown>;
  markLoaded(remoteName: string): void;
}

interface RemoteRefreshState {
  nextCheckAt: number;
  refreshing?: Promise<void>;
}

type RuntimeHost = NonNullable<ReturnType<typeof getInstance>>;

interface RuntimeRemoteInfo {
  alias?: string;
  entry: string;
  entryGlobalName?: string;
  name: string;
  type?: string;
  version?: string;
}

interface PortableSsrEntryLoaderPlugin {
  apply(host: RuntimeHost): void;
  loadEntry(options: {
    origin?: RuntimeHost;
    remoteInfo: RuntimeRemoteInfo;
  }): Promise<{ get: unknown; init: unknown } | undefined>;
  name: string;
}

export default function portableSsrEntryLoader(
  options: PortableSsrEntryLoaderOptions,
): PortableSsrEntryLoaderPlugin {
  const {
    hostName,
    portableResolvedShared = {},
    requiredPackages = [],
    runtimePackages = [],
    ...upstreamOptions
  } = options;
  const runtimePackageSet = new Set(runtimePackages);
  const bareRequiredPackages = requiredPackages.filter(
    (packageName) => !runtimePackageSet.has(packageName),
  );
  // Bare server externals must resolve beside MF Vite's temporary modules.
  // Runtime support may legitimately live beside this package instead
  // (notably under strict pnpm), so it is resolved independently below.
  const runtimeNodeModules = findRuntimeNodeModules(bareRequiredPackages);
  if (!runtimeNodeModules) {
    throw new Error(
      "[module-federation] Cannot locate the deployed server node_modules directory for SSR remote loading.",
    );
  }
  if (!usesAvailableVmStrategy(upstreamOptions.strategy)) {
    preparePortableSsrCache(runtimeNodeModules);
  }
  const runtimeRequires = extendRuntimeRequires(
    runtimePackages,
    createRuntimeRequires(runtimeNodeModules, true),
  );
  const portableRequires = extendRuntimeRequires(
    Object.values(portableResolvedShared).map((mapping) => mapping.packageName),
    createRuntimeRequires(runtimeNodeModules, false),
  );
  const resolvedShared = resolveRuntimeShared(runtimePackages, runtimeRequires);
  const missingRuntimePackages = runtimePackages.filter(
    (packageName) => !resolvedShared[packageName],
  );
  if (missingRuntimePackages.length > 0) {
    throw new Error(
      `[module-federation] Cannot resolve SSR runtime packages from the deployed server: ${missingRuntimePackages.join(", ")}.`,
    );
  }
  Object.assign(
    resolvedShared,
    resolvePortableShared(portableResolvedShared, portableRequires),
  );
  const entryLoader = ssrEntryLoaderPlugin({
    ...upstreamOptions,
    resolvedShared,
  });
  const plugin: PortableSsrEntryLoaderPlugin = {
    ...entryLoader,
    apply(host) {
      installManifestFetchTimeout(host, options.fetchTimeoutMs);
    },
    async loadEntry(loadOptions) {
      const remoteInfo = resolveOriginalRemoteInfo(
        loadOptions.origin,
        loadOptions.remoteInfo,
      );
      const container = await entryLoader.loadEntry({
        ...loadOptions,
        remoteInfo,
      });

      if (container) return container;

      // Returning undefined lets runtime-core fall through to its generic
      // Node loader, which fetches the browser entry without our timeout.
      throw new Error(
        `[module-federation] Failed to load an SSR entry for remote "${remoteInfo.name}" from "${remoteInfo.entry}".`,
      );
    },
  };
  const refreshStates = new Map<string, RemoteRefreshState>();
  const refreshEnabled =
    typeof options.maxAgeMs === "number" && options.maxAgeMs >= 0;
  const getHost = () =>
    getInstance((instance) => instance.options.name === hostName);

  const bridge: SsrRuntimeBridge = {
    async load(remoteName, importPath) {
      const host = getHost();
      if (!host) {
        throw new Error(
          `[module-federation] Host runtime "${hostName}" is not initialized.`,
        );
      }

      const refreshState = refreshStates.get(remoteName);
      if (refreshEnabled && refreshState?.refreshing) {
        return host.loadRemote(importPath);
      }

      if (
        refreshEnabled &&
        refreshState &&
        Date.now() >= refreshState.nextCheckAt
      ) {
        const refreshing = (async () => {
          const refreshed = await refreshRemoteEntry(plugin, host, remoteName);
          // Keep serving the loaded container if a periodic refresh fails.
          // Once the replacement is reachable, clear Runtime's two caches so
          // its next load observes MF Vite's freshly validated entry.
          if (
            refreshed &&
            refreshStates.get(remoteName) === refreshState &&
            bridges.get(hostName) === bridge &&
            getHost() === host
          ) {
            resetHostRemote(host, remoteName);
          }
        })();
        refreshState.refreshing = refreshing;

        void refreshing
          .catch((error) => {
            console.warn(
              `[module-federation] Failed to activate refreshed SSR remote "${remoteName}"; continuing with the cached version.`,
              error,
            );
          })
          .finally(() => {
            if (refreshStates.get(remoteName) === refreshState) {
              refreshState.refreshing = undefined;
              refreshState.nextCheckAt = Date.now() + options.maxAgeMs!;
            }
          });
        return host.loadRemote(importPath);
      }

      const loaded = await host.loadRemote(importPath);
      if (refreshEnabled && !refreshState) {
        refreshStates.set(remoteName, {
          nextCheckAt: Date.now() + options.maxAgeMs!,
        });
      }
      return loaded;
    },
    markLoaded(remoteName) {
      if (
        bridges.get(hostName) !== bridge ||
        !refreshEnabled ||
        refreshStates.has(remoteName)
      ) {
        return;
      }

      refreshStates.set(remoteName, {
        nextCheckAt: Date.now() + options.maxAgeMs!,
      });
    },
    invalidate(remoteName) {
      if (bridges.get(hostName) !== bridge) return;

      const host = getHost();
      refreshStates.delete(remoteName);
      if (!host) return;

      // Failed loader entries remove themselves from MF Vite's caches. Reset
      // only this host's failed Runtime module; upstream revalidate() clears
      // every federation instance's moduleCache, even when given one URL.
      resetHostRemote(host, remoteName);
    },
  };

  const runtimeGlobal = globalThis as typeof globalThis &
    Record<symbol, Map<string, SsrRuntimeBridge> | undefined>;
  const bridges =
    runtimeGlobal[SSR_RUNTIME_BRIDGES] || new Map<string, SsrRuntimeBridge>();
  bridges.set(hostName, bridge);
  runtimeGlobal[SSR_RUNTIME_BRIDGES] = bridges;

  return plugin;
}

async function refreshRemoteEntry(
  entryLoader: Pick<PortableSsrEntryLoaderPlugin, "loadEntry">,
  host: RuntimeHost,
  remoteName: string,
) {
  const remote = host.options.remotes.find(
    (candidate) =>
      candidate.name === remoteName || candidate.alias === remoteName,
  );
  const cachedModule = remote ? host.moduleCache.get(remote.name) : undefined;
  const cachedContainer = cachedModule?.remoteEntryExports;
  if (!remote || !cachedModule || !cachedContainer) return false;

  try {
    const refreshedContainer = await entryLoader.loadEntry({
      origin: host,
      remoteInfo: cachedModule.remoteInfo,
    });
    return Boolean(
      refreshedContainer &&
      (refreshedContainer.get !== cachedContainer.get ||
        refreshedContainer.init !== cachedContainer.init),
    );
  } catch (error) {
    console.warn(
      `[module-federation] Failed to refresh SSR remote "${remoteName}"; continuing with the cached version.`,
      error,
    );
    return false;
  }
}

function resolveOriginalRemoteInfo(
  host: RuntimeHost | undefined,
  remoteInfo: RuntimeRemoteInfo,
): RuntimeRemoteInfo {
  // runtime-core records the manifest URL as the snapshot version before it
  // replaces entry with the resolved SSR asset. Preserve that exact URL so
  // custom manifest paths remain versioned and refreshable.
  if (isManifestUrl(remoteInfo.version)) {
    return { ...remoteInfo, entry: remoteInfo.version };
  }

  if (isManifestUrl(remoteInfo.entry)) return remoteInfo;

  const configuredRemote = host?.options.remotes.find(
    (candidate) =>
      candidate.name === remoteInfo.name ||
      candidate.alias === remoteInfo.name ||
      candidate.name === remoteInfo.alias,
  );
  if (
    !configuredRemote ||
    !("entry" in configuredRemote) ||
    !configuredRemote.entry
  ) {
    return remoteInfo;
  }

  return { ...remoteInfo, entry: configuredRemote.entry };
}

function isManifestUrl(value: string | undefined): value is string {
  return Boolean(value && /\.json(?:$|[?#])/i.test(value));
}

function installManifestFetchTimeout(
  host: RuntimeHost,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
) {
  const fetchHook = host.loaderHook.lifecycle.fetch;
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    patchedManifestFetchHooks.has(fetchHook)
  ) {
    return;
  }

  patchedManifestFetchHooks.add(fetchHook);
  const emit = fetchHook.emit.bind(fetchHook);

  const timedEmit = async (...args: Parameters<typeof fetchHook.emit>) => {
    const [input, init, remoteInfo, resourceContext] = args;
    if (resourceContext?.resourceType !== "manifest") {
      return emit(input, init, remoteInfo, resourceContext);
    }

    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;
    const requestInit = { ...init, signal };
    const customResponse = await waitForAbort(
      emit(input, requestInit, remoteInfo, resourceContext),
      signal,
    );
    if (customResponse instanceof Response) return customResponse;

    return waitForAbort(fetch(input, requestInit), signal);
  };
  fetchHook.emit = timedEmit as unknown as typeof fetchHook.emit;
}

function waitForAbort<T>(operation: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason);

  return new Promise<T>((resolveOperation, rejectOperation) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      rejectOperation(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolveOperation(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        rejectOperation(error);
      },
    );
  });
}

function resetHostRemote(host: RuntimeHost, remoteName: string) {
  const remote = host.options.remotes.find(
    (candidate) =>
      candidate.name === remoteName || candidate.alias === remoteName,
  );
  if (!remote) return;

  // Keep this ordering: force-registration needs the cached Module in order
  // to clear Runtime's global entry promise for the failed remote.
  host.registerRemotes([{ ...remote }], { force: true });
}

function usesAvailableVmStrategy(strategy: "temp-file" | "vm" | undefined) {
  return (
    strategy === "vm" &&
    typeof vm.SourceTextModule === "function" &&
    typeof vm.SyntheticModule === "function"
  );
}

function createRuntimeRequires(
  runtimeNodeModules: string,
  preferLoader: boolean,
) {
  const requires: NodeJS.Require[] = [];
  const deployedEntry = resolve(dirname(runtimeNodeModules), "package.json");
  const loaderEntry = toFilePath(import.meta.url);
  const processEntry = process.argv[1] ? resolve(process.argv[1]) : undefined;
  const workingEntry = resolve(process.cwd(), "package.json");
  const locations = preferLoader
    ? [loaderEntry, deployedEntry, processEntry, workingEntry]
    : [deployedEntry, workingEntry, processEntry, loaderEntry];

  // Nitro traces dependencies beside its deployed entry. Prefer that location;
  // argv may instead name an external bootstrap or be absent under node -e.
  for (const location of new Set(locations)) {
    if (location) requires.push(createRequire(location));
  }

  return requires;
}

function extendRuntimeRequires(
  packageSpecifiers: string[],
  initialRequires: NodeJS.Require[],
) {
  const runtimeRequires = [...initialRequires];
  const packageRoots = new Set<string>();
  const pending = new Set(
    packageSpecifiers
      .map(packageNameFromSpecifier)
      .filter((packageName): packageName is string =>
        Boolean(packageName && !isBuiltin(packageName)),
      ),
  );

  // A strict pnpm package exposes its own direct dependencies from its virtual
  // store directory, not from the consuming app. Each resolved package adds a
  // new runtime-relative base so transitive MF support packages can be found.
  let resolvedPackage = true;
  while (pending.size > 0 && resolvedPackage) {
    resolvedPackage = false;
    for (const packageName of pending) {
      const packageRoot = findRuntimePackageRoot(packageName, runtimeRequires);
      if (!packageRoot) continue;

      pending.delete(packageName);
      resolvedPackage = true;
      if (packageRoots.has(packageRoot)) continue;

      packageRoots.add(packageRoot);
      runtimeRequires.push(createRequire(resolve(packageRoot, "package.json")));
    }
  }

  return runtimeRequires;
}

function findRuntimePackageRoot(
  packageName: string,
  runtimeRequires: NodeJS.Require[],
) {
  for (const require of runtimeRequires) {
    for (const searchPath of require.resolve.paths(packageName) || []) {
      const packageRoot = resolve(searchPath, packageName);
      if (existsSync(resolve(packageRoot, "package.json"))) {
        return realpathSync(packageRoot);
      }
    }
  }
}

function preparePortableSsrCache(runtimeNodeModules: string) {
  const cacheDirectory = resolve(process.cwd(), "node_modules", ".ssr-cache");
  const cacheNodeModules = resolve(cacheDirectory, "node_modules");
  mkdirSync(cacheDirectory, { recursive: true });

  try {
    linkCacheNodeModules(runtimeNodeModules, cacheNodeModules);
  } catch (error) {
    throw new Error(
      `[module-federation] Cannot link the SSR cache to deployed dependencies at ${runtimeNodeModules}.`,
      { cause: error },
    );
  }
}

function linkCacheNodeModules(
  runtimeNodeModules: string,
  cacheNodeModules: string,
) {
  const createLink = () =>
    symlinkSync(
      runtimeNodeModules,
      cacheNodeModules,
      process.platform === "win32" ? "junction" : "dir",
    );

  try {
    createLink();
    return;
  } catch (error) {
    if (isSameDirectory(cacheNodeModules, runtimeNodeModules)) return;

    let cacheNodeModulesStat;
    try {
      cacheNodeModulesStat = lstatSync(cacheNodeModules);
    } catch {
      throw error;
    }

    // Never remove a real directory. A previous server or test may have left
    // a stale (including dangling) link in this process's isolated cache.
    if (!cacheNodeModulesStat.isSymbolicLink()) throw error;
    unlinkSync(cacheNodeModules);

    try {
      createLink();
    } catch (replacementError) {
      // Another process using the same unsupported shared cache may have won
      // the race with the same target. Accept only that exact outcome.
      if (!isSameDirectory(cacheNodeModules, runtimeNodeModules)) {
        throw replacementError;
      }
    }
  }
}

function isSameDirectory(left: string, right: string) {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return false;
  }
}

function findRuntimeNodeModules(requiredPackages: string[]) {
  // Bundlers retain or rewrite this to the deployed loader/server entry. The
  // process entry can instead be an external bootstrap, or absent under -e.
  const loaderPath = toFilePath(import.meta.url);
  const fromLoader =
    loaderPath && findClosestNodeModules(loaderPath, requiredPackages);
  if (fromLoader) return fromLoader;

  const fromWorkingDirectory = findClosestNodeModules(
    resolve(process.cwd(), "package.json"),
    requiredPackages,
  );
  if (fromWorkingDirectory) return fromWorkingDirectory;

  return process.argv[1]
    ? findClosestNodeModules(resolve(process.argv[1]), requiredPackages)
    : undefined;
}

function toFilePath(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "file:" || parsed.pathname === "/_entry.js") return;
    return fileURLToPath(parsed);
  } catch {
    return;
  }
}

function findClosestNodeModules(path: string, requiredPackages: string[]) {
  let directory = dirname(path);
  while (true) {
    const nodeModules = resolve(directory, "node_modules");
    if (
      existsSync(nodeModules) &&
      containsRuntimePackages(nodeModules, requiredPackages)
    ) {
      return realpathSync(nodeModules);
    }

    const parent = dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}

function containsRuntimePackages(
  nodeModules: string,
  requiredPackages: string[],
) {
  return requiredPackages.every((specifier) => {
    const packageName = packageNameFromSpecifier(specifier);
    return (
      !packageName ||
      isBuiltin(packageName) ||
      existsSync(resolve(nodeModules, packageName, "package.json"))
    );
  });
}

function packageNameFromSpecifier(specifier: string) {
  const parts = specifier.split("/");
  return specifier.startsWith("@")
    ? parts.length >= 2
      ? `${parts[0]}/${parts[1]}`
      : undefined
    : parts[0] || undefined;
}
