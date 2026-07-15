import { federation } from "@module-federation/vite";
import { addVitePlugin, resolvePath, useNuxt } from "@nuxt/kit";
import { existsSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getStatsFileName, resolveManifestFileName } from "./federation-paths";
import { isJsonObject, parseJsonObject } from "./json";
import type { ModuleOptions } from "./options";
import { isMfRemoteEntryImporter } from "./runtime-plugin-importer";
import { publishServerExposes } from "./server-exposes";
import {
  getLocallyProvidedSharedPackageNames,
  getSharedPackageNames,
} from "./shared";
import {
  createPortableResolvedShared,
  createSsrEntryLoaderPlugin,
  mergeSsrRequiredPackageNames,
  mergeSsrRuntimePackageNames,
  selectSsrRuntimePackageNames,
  SSR_ENTRY_LOADER_PLUGIN,
  type PortableSharedResolution,
} from "./ssr-entry-loader-config";

const NUXT_SSR_ESM_EXTERNALS = ["vue", "vue-router"];
const COMMON_SSR_SHARED_PACKAGES = [
  "@module-federation/runtime",
  "@module-federation/runtime-core",
  "@module-federation/sdk",
];
const SHARED_STRATEGY_PLUGIN = "@module-federation/nuxt/shared-strategy";
const COMMONJS_PROXY_SUFFIX = "?commonjs-proxy";
const CLIENT_SSR_ENTRY_LOADER_STUB =
  "\0module-federation:nuxt:ssr-entry-loader-stub";
const DISABLED_SSR_ENTRY_LOADER =
  "\0module-federation:nuxt:ssr-entry-loader-disabled";
type FederationConfig = NonNullable<ModuleOptions["config"]>;
type RuntimePluginEntry = NonNullable<
  FederationConfig["runtimePlugins"]
>[number];

interface SsrPatchContext {
  enableSsrRemoteLoader: boolean;
  fetchTimeoutMs?: number;
  manifestMaxAgeMs?: number;
  portableResolvedShared: Record<string, PortableSharedResolution>;
  requiredPackages: string[];
  runtimePackages: string[];
}

export async function registerFederationPlugin(
  options: ModuleOptions,
  exposed: Record<string, string>,
  rootDir = process.cwd(),
  ssrOptions: { remoteSsr?: boolean } = {},
) {
  const enableSsrRemoteLoader =
    ssrOptions.remoteSsr !== false && hasRemotes(options.config || {});
  const ssrShared = await resolveSsrShared(options, rootDir);
  const portableResolvedShared = enableSsrRemoteLoader
    ? createPortableResolvedShared(
        getConfiguredResolvedShared(options.config),
        rootDir,
      )
    : { mappings: {}, traceIncludes: [] };

  registerRuntimePluginResolver();
  registerServerFederationPrePlugin(enableSsrRemoteLoader);
  registerClientSsrEntryLoaderStubPlugin();
  if (enableSsrRemoteLoader) {
    registerNitroTraceIncludes([
      ...ssrShared.traceIncludes,
      ...portableResolvedShared.traceIncludes,
    ]);
  }

  // MF Vite keeps normalized config and used-share state at module scope.
  // Register one plugin for both environments so Nuxt's server config cannot
  // overwrite the browser share graph. The config remains lazy because
  // `exposed` is populated after Nuxt's component hooks run.
  const clientOutDir = resolve(useNuxt().options.buildDir, "dist/client");
  addVitePlugin(() => {
    const config = patchMFConfig(
      createFederationConfig(options, exposed, rootDir),
      {
        enableSsrRemoteLoader,
        fetchTimeoutMs: options.ssrFetchTimeoutMs,
        manifestMaxAgeMs: options.ssrManifestMaxAgeMs,
        portableResolvedShared: portableResolvedShared.mappings,
        requiredPackages: ssrShared.requiredPackages,
        runtimePackages: ssrShared.runtimePackages,
      },
    );

    return publishServerExposes(
      federation(config),
      {
        externalPackages: ssrShared.externalPackages,
        exposes: config.exposes,
        filename: config.filename,
        manifestFileName:
          options.config?.manifest === false
            ? undefined
            : resolveManifestFileName(options),
        name: config.name,
      },
      rootDir,
      clientOutDir,
    );
  });

  registerServerTargetPlugin();
  registerServerCommonJsInteropPlugin(ssrShared.esmExternals);
  registerManifestMetadataPlugin(options);
}

function patchMFConfig(
  config: ReturnType<typeof createFederationConfig>,
  ssr: SsrPatchContext,
) {
  const runtimePlugins: RuntimePluginEntry[] = [
    ...(config.runtimePlugins || []),
  ];

  injectRuntimePlugin(runtimePlugins, SHARED_STRATEGY_PLUGIN);
  if (hasRemotes(config)) {
    upsertPortableSsrEntryLoader(runtimePlugins, {
      enabled: ssr.enableSsrRemoteLoader,
      fetchTimeoutMs: ssr.fetchTimeoutMs,
      hostName: config.name,
      manifestMaxAgeMs: ssr.manifestMaxAgeMs,
      portableResolvedShared: ssr.portableResolvedShared,
      requiredPackages: ssr.requiredPackages,
      runtimePackages: ssr.runtimePackages,
    });
  }

  const patchedConfig = { ...config, runtimePlugins };
  // One MF plugin serves Nuxt's client and server environments. Leave target
  // unset so MF Vite selects "web" for the client and "node" for SSR instead
  // of leaking a user-supplied browser target into the server build.
  const { target: _environmentSpecificTarget, ...dualEnvironmentConfig } =
    patchedConfig;
  return dualEnvironmentConfig;
}

function upsertPortableSsrEntryLoader(
  runtimePlugins: RuntimePluginEntry[],
  options: {
    enabled: boolean;
    fetchTimeoutMs?: number;
    hostName: string;
    manifestMaxAgeMs?: number;
    portableResolvedShared: Record<string, PortableSharedResolution>;
    requiredPackages: string[];
    runtimePackages: string[];
  },
) {
  const existingIndex = runtimePlugins.findIndex(
    (plugin) => runtimePluginSpecifier(plugin) === SSR_ENTRY_LOADER_PLUGIN,
  );
  const existing = existingIndex >= 0 ? runtimePlugins[existingIndex] : null;
  const existingOptions =
    Array.isArray(existing) && isJsonObject(existing[1]) ? existing[1] : {};
  const {
    requiredPackages: configuredRequiredPackages,
    resolvedShared: _configuredResolvedShared,
    runtimePackages: configuredRuntimePackages,
    sharedPackages: _legacySharedPackages,
    ...portableOptions
  } = existingOptions;
  const loaderOptions = {
    ...portableOptions,
    fetchTimeoutMs: options.fetchTimeoutMs,
    hostName: options.hostName,
    maxAgeMs: options.manifestMaxAgeMs,
    ...(Object.keys(options.portableResolvedShared).length > 0
      ? { portableResolvedShared: options.portableResolvedShared }
      : {}),
    requiredPackages: mergeSsrRequiredPackageNames(
      configuredRequiredPackages,
      options.requiredPackages,
    ),
    runtimePackages: mergeSsrRuntimePackageNames(
      configuredRuntimePackages,
      options.runtimePackages,
    ),
  };
  const plugin = createSsrEntryLoaderPlugin(
    options.enabled,
    loaderOptions,
  ) as RuntimePluginEntry;

  if (existingIndex >= 0) {
    runtimePlugins[existingIndex] = plugin;
  } else {
    runtimePlugins.push(plugin);
  }
}

function injectRuntimePlugin(
  runtimePlugins: RuntimePluginEntry[],
  plugin: RuntimePluginEntry,
) {
  const specifier = runtimePluginSpecifier(plugin);
  const hasPlugin = runtimePlugins.some(
    (existing) => runtimePluginSpecifier(existing) === specifier,
  );

  if (!hasPlugin) runtimePlugins.push(plugin);
}

function runtimePluginSpecifier(plugin: RuntimePluginEntry) {
  return typeof plugin === "string" ? plugin : plugin[0];
}

function getConfiguredResolvedShared(config: ModuleOptions["config"]) {
  return getConfiguredSsrEntryLoaderOptions(config)?.resolvedShared;
}

function getConfiguredRuntimePackageNames(config: ModuleOptions["config"]) {
  const configured =
    getConfiguredSsrEntryLoaderOptions(config)?.runtimePackages;
  return Array.isArray(configured) ? configured.filter(isString) : [];
}

function getConfiguredSsrEntryLoaderOptions(config: ModuleOptions["config"]) {
  const configuredLoader = config?.runtimePlugins?.find(
    (plugin) => runtimePluginSpecifier(plugin) === SSR_ENTRY_LOADER_PLUGIN,
  );
  if (!Array.isArray(configuredLoader) || !isJsonObject(configuredLoader[1])) {
    return;
  }

  return configuredLoader[1];
}

function hasRemotes(config: FederationConfig) {
  return Boolean(config.remotes && Object.keys(config.remotes).length > 0);
}

function createFederationConfig(
  options: ModuleOptions,
  exposed: Record<string, string>,
  rootDir: string,
) {
  return {
    dts: false,
    name: "remote",
    filename: "remoteEntry.js",
    manifest: resolveManifestOptions(options),
    ...options.config,
    exposes: {
      ...normalizeExposePaths(exposed, rootDir),
      ...normalizeExposePaths(options.config?.exposes, rootDir),
    },
  };
}

function normalizeExposePaths(
  exposes: FederationConfig["exposes"] | undefined,
  rootDir: string,
) {
  if (!isJsonObject(exposes)) return exposes;

  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(exposes)) {
    if (typeof value === "string") {
      normalized[key] = normalizeExposeImportPath(value, rootDir);
      continue;
    }

    if (isJsonObject(value) && typeof value.import === "string") {
      normalized[key] = {
        ...value,
        import: normalizeExposeImportPath(value.import, rootDir),
      };
      continue;
    }

    normalized[key] = value;
  }

  return normalized as FederationConfig["exposes"];
}

function normalizeExposeImportPath(importPath: string, rootDir: string) {
  if (!importPath.startsWith(".")) return importPath;

  return resolve(rootDir, importPath);
}

async function resolveSsrShared(options: ModuleOptions, rootDir: string) {
  const sharedPackages = getSharedPackageNames(options.config?.shared);
  const locallyProvidedSharedPackages = getLocallyProvidedSharedPackageNames(
    options.config?.shared,
  );
  const configuredSsrExternals = (options.config?.ssrExternals || []).filter(
    isString,
  );
  const esmExternals = NUXT_SSR_ESM_EXTERNALS.filter((packageName) =>
    sharedPackages.has(packageName),
  );
  const appRequire = createRequire(resolve(rootDir, "package.json"));
  const moduleRequire = createRequire(import.meta.url);
  const pluginRequire = createVitePackageRequire(moduleRequire);
  const runtimePackages = selectSsrRuntimePackageNames(
    COMMON_SSR_SHARED_PACKAGES,
    sharedPackages,
  );
  const runtimePackageNames = new Set([
    ...runtimePackages,
    ...getConfiguredRuntimePackageNames(options.config),
  ]);
  const externalPackages = [
    ...new Set([
      ...COMMON_SSR_SHARED_PACKAGES,
      ...sharedPackages,
      ...esmExternals,
      ...configuredSsrExternals,
    ]),
  ];
  const requiredPackages = [
    ...new Set([
      ...COMMON_SSR_SHARED_PACKAGES,
      ...locallyProvidedSharedPackages,
      ...esmExternals,
      ...configuredSsrExternals,
    ]),
  ];
  const traceIncludes: string[] = [];

  for (const packageName of new Set([
    ...requiredPackages,
    ...runtimePackageNames,
  ])) {
    if (isBuiltin(packageName)) continue;

    if (!runtimePackageNames.has(packageName)) {
      // Resolve trace roots under ESM import conditions. A createRequire path
      // would pin a dual package's CJS branch, while a bare Nitro trace root is
      // passed to NFT as a filesystem path instead of being package-resolved.
      const resolved = await resolvePath(packageName, { cwd: rootDir });
      if (!existsSync(resolved)) {
        throw new Error(
          `[module-federation] Cannot resolve SSR dependency "${packageName}" from ${rootDir}. Install it in the Nuxt application.`,
        );
      }
      traceIncludes.push(resolved);
      continue;
    }

    const resolved = resolvePackage(packageName, appRequire, pluginRequire);
    if (resolved) traceIncludes.push(resolved);
  }

  return {
    esmExternals,
    externalPackages,
    requiredPackages,
    runtimePackages,
    traceIncludes,
  };
}

function createVitePackageRequire(require: NodeJS.Require) {
  try {
    return createRequire(
      require.resolve("@module-federation/vite/package.json"),
    );
  } catch {
    return require;
  }
}

function resolvePackage(
  packageName: string,
  appRequire: NodeJS.Require,
  pluginRequire: NodeJS.Require,
) {
  try {
    return appRequire.resolve(packageName);
  } catch {
    try {
      return pluginRequire.resolve(packageName);
    } catch {
      return;
    }
  }
}

function registerServerFederationPrePlugin(enableSsrRemoteLoader: boolean) {
  const portableLoaderPath = fileURLToPath(
    new URL("./ssr-entry-loader.mjs", import.meta.url),
  );

  addVitePlugin(
    {
      name: "module-federation:nuxt:portable-ssr-entry-loader",
      enforce: "pre",
      resolveId(id, importer) {
        if (id !== SSR_ENTRY_LOADER_PLUGIN) return;
        if (!isMfRemoteEntryImporter(importer)) return;

        return enableSsrRemoteLoader
          ? portableLoaderPath
          : DISABLED_SSR_ENTRY_LOADER;
      },
      load(id) {
        if (id === DISABLED_SSR_ENTRY_LOADER) {
          return `export default () => ({
            name: "mf-vite:ssr-entry-loader-disabled",
            async loadEntry() {
              throw new Error("[module-federation] SSR remote loading is disabled.");
            },
          });`;
        }

        const target = resolveMfCommonJsProxyTarget(id);
        if (!target) return;

        // MF Vite's virtual loader also matches Rollup's wrapped proxy ID and
        // otherwise replaces the proxy with the original load-share module.
        return `
          import { getAugmentedNamespace } from "\\0commonjsHelpers.js";
          import * as module from ${JSON.stringify(target)};
          export default /*@__PURE__*/ getAugmentedNamespace(module);
        `;
      },
    },
    { client: false, prepend: true },
  );
}

function registerRuntimePluginResolver() {
  const sharedStrategyPath = fileURLToPath(
    new URL("./shared-strategy.mjs", import.meta.url),
  );

  addVitePlugin(
    {
      name: "module-federation:nuxt:runtime-plugin-resolver",
      enforce: "pre",
      resolveId(id) {
        // Runtime plugin imports originate in MF virtual modules, which have
        // no filesystem parent for normal package export resolution.
        if (id === SHARED_STRATEGY_PLUGIN) return sharedStrategyPath;
      },
    },
    { prepend: true },
  );
}

function registerClientSsrEntryLoaderStubPlugin() {
  addVitePlugin(
    {
      name: "module-federation:nuxt:client-ssr-entry-loader-stub",
      enforce: "pre",
      resolveId(id, importer) {
        if (
          id === SSR_ENTRY_LOADER_PLUGIN &&
          isMfRemoteEntryImporter(importer)
        ) {
          return CLIENT_SSR_ENTRY_LOADER_STUB;
        }
      },
      load(id) {
        if (id !== CLIENT_SSR_ENTRY_LOADER_STUB) return;

        return `export default () => ({ name: "mf-vite:ssr-entry-loader-client-stub" });`;
      },
    },
    { server: false, prepend: true },
  );
}

function resolveMfCommonJsProxyTarget(id: string) {
  if (!id.endsWith(COMMONJS_PROXY_SUFFIX)) return;

  const target = id.slice(1, -COMMONJS_PROXY_SUFFIX.length);
  if (!target.startsWith("\0virtual:mf:")) return;
  if (!target.includes("__loadShare__")) return;

  return target;
}

function registerServerTargetPlugin() {
  addVitePlugin({
    name: "module-federation:nuxt:ssr-target",
    enforce: "post",
    configEnvironment(name, config) {
      if (name !== "ssr" && config.consumer !== "server") return;

      // MF Vite's root config hook runs before environment configs and can
      // seed the browser target. The inherited value must be corrected for
      // Nuxt's shared SSR environment.
      config.define ??= {};
      config.define.ENV_TARGET = JSON.stringify("node");
    },
  });
}

function registerNitroTraceIncludes(traceIncludes: string[]) {
  if (traceIncludes.length === 0) return;

  const nuxtOptions = useNuxt().options as unknown as {
    nitro?: { externals?: { traceInclude?: string[] } };
  };
  nuxtOptions.nitro ??= {};
  nuxtOptions.nitro.externals ??= {};
  nuxtOptions.nitro.externals.traceInclude = [
    ...new Set([
      ...(nuxtOptions.nitro.externals.traceInclude || []),
      ...traceIncludes,
    ]),
  ];
}

function registerServerCommonJsInteropPlugin(esmExternals: string[]) {
  if (esmExternals.length === 0) return;

  addVitePlugin({
    name: "module-federation:nuxt:ssr-commonjs-esm-externals",
    apply: "build",
    config(config) {
      if (config.build?.ssr !== true) return;

      applyEsmExternals(config.build, esmExternals);
    },
    configEnvironment(name, config) {
      if (name !== "ssr" && config.consumer !== "server") return;

      config.build ??= {};
      applyEsmExternals(config.build, esmExternals);
    },
  });
}

function applyEsmExternals(
  build: { commonjsOptions?: { esmExternals?: unknown } },
  packageNames: string[],
) {
  build.commonjsOptions ??= {};
  build.commonjsOptions.esmExternals = mergeEsmExternals(
    build.commonjsOptions.esmExternals,
    packageNames,
  );
}

function mergeEsmExternals(existing: unknown, packageNames: string[]) {
  if (existing === true) return true;

  const matchesNuxtExternal = (id: string) =>
    packageNames.some(
      (packageName) => id === packageName || id.startsWith(`${packageName}/`),
    );

  if (typeof existing === "function") {
    return (id: string) =>
      matchesNuxtExternal(id) || (existing as (id: string) => boolean)(id);
  }

  if (Array.isArray(existing)) {
    return [...new Set([...existing.filter(isString), ...packageNames])];
  }

  return packageNames;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function registerCorsPlugin() {
  addVitePlugin({
    name: "module-federation:nuxt:config",
    config() {
      return {
        server: { cors: true },
      };
    },
  });
}

function resolveManifestOptions(options: ModuleOptions) {
  if (options.config?.manifest === false) {
    return false;
  }

  if (
    options.config?.manifest &&
    typeof options.config.manifest !== "boolean"
  ) {
    return {
      fileName: "mf-manifest.json",
      ...options.config.manifest,
    };
  }

  return {
    fileName: "mf-manifest.json",
  };
}

function registerManifestMetadataPlugin(options: ModuleOptions) {
  const metadata = resolveManifestMetadata(options);
  if (Object.keys(metadata).length === 0) return;

  const manifestFileName = resolveManifestFileName(options);
  const statsFileName = getStatsFileName(manifestFileName);

  addVitePlugin({
    name: "module-federation:nuxt:manifest-metadata",
    apply: "build",
    enforce: "post",
    generateBundle(_, bundle) {
      for (const fileName of [manifestFileName, statsFileName]) {
        const asset = bundle[fileName];
        if (
          !asset ||
          asset.type !== "asset" ||
          typeof asset.source !== "string"
        ) {
          continue;
        }

        const manifest = parseJsonObject(asset.source);
        if (!manifest) continue;

        const metaData = isJsonObject(manifest.metaData)
          ? manifest.metaData
          : {};
        const custom = isJsonObject(metaData.custom) ? metaData.custom : {};

        metaData.custom = {
          ...custom,
          ...metadata,
        };
        manifest.metaData = metaData;
        asset.source = JSON.stringify(manifest);
      }
    },
  });
}

function resolveManifestMetadata(options: ModuleOptions) {
  if (options.manifestMetadata) return options.manifestMetadata;

  return Object.fromEntries(
    Object.entries({
      commit: process.env.GIT_SHA,
      deployEnv: process.env.DEPLOY_ENV,
      owner: process.env.MF_OWNER,
    }).filter(([, value]) => Boolean(value)),
  );
}
