import type { moduleFederationPlugin } from "@module-federation/enhanced";
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import {
  addRspackPlugin,
  extendRspackConfig,
  resolvePath,
  useNuxt,
} from "@nuxt/kit";
import { existsSync, realpathSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveManifestFileName,
  resolveRemoteEntryFileName,
  resolveSsrRemoteEntryFileName,
} from "./federation-paths";
import { isJsonObject } from "./json";
import { normalizeBase, type ModuleOptions } from "./options";
import { resolveRemoteEntry } from "./remotes";
import { registerRspackDevAssets } from "./rspack-dev-assets";
import { patchRspackServerChunkLoading } from "./rspack-chunk-loading";
import { resolveRspackPackageDependency } from "./rspack-package-dependencies";
import {
  isVersionShorthand,
  resolveServerVueExternal,
  usesNativeServerVue,
} from "./rspack-server-vue";
import {
  normalizeRspackRemotes,
  resolveRspackRemoteOptions,
} from "./rspack-remotes";
import {
  registerRspackServerExposesPublisher,
  sanitizeRspackServerSource,
} from "./rspack-server-exposes";
import {
  createPortableResolvedShared,
  mergeSsrRequiredPackageNames,
  mergeSsrRuntimePackageNames,
  selectSsrRuntimePackageNames,
  SSR_ENTRY_LOADER_PLUGIN,
} from "./ssr-entry-loader-config";
import {
  getImportFalseSharedPackageNames,
  getLocallyProvidedSharedPackageNames,
  getSharedPackageNames,
  validateImportFalseSharedPackages,
} from "./shared";

type RspackFederationOptions =
  moduleFederationPlugin.ModuleFederationPluginOptions;
type RuntimePluginEntry = NonNullable<
  RspackFederationOptions["runtimePlugins"]
>[number];
type RspackManifestOptions = Exclude<
  RspackFederationOptions["manifest"],
  boolean | undefined
>;

const COMMON_SSR_PACKAGES = [
  "@module-federation/runtime",
  "@module-federation/runtime-core",
  "@module-federation/sdk",
];
const NUXT_SSR_SHARED_PACKAGES = ["vue", "vue-router"];

export async function registerRspackFederationPlugin(
  options: ModuleOptions,
  exposed: Record<string, string>,
  rootDir = process.cwd(),
  ssrOptions: { remoteSsr?: boolean } = {},
) {
  const enableSsrRemoteLoader =
    Boolean(useNuxt().options.ssr) &&
    options.ssr !== false &&
    ssrOptions.remoteSsr !== false &&
    hasRemotes(options.config);
  const nativeServerVue = usesNativeServerVue(options.config?.shared);
  if (
    nativeServerVue &&
    useNuxt().options.ssr &&
    useNuxt().options.experimental.externalVue === false
  ) {
    throw new Error(
      "[module-federation] Rspack SSR with shared Vue requires experimental.externalVue to be enabled so the host renderer and remote components use the same Vue runtime.",
    );
  }
  if (nativeServerVue) {
    registerNitroTraceIncludes(
      await resolveTraceIncludes(["vue", "vue/server-renderer"], rootDir),
    );
  }
  if (enableSsrRemoteLoader) {
    validateImportFalseSharedPackages(rootDir, options.config?.shared);
  }
  const sharedStrategyPath = fileURLToPath(
    new URL("./shared-strategy.mjs", import.meta.url),
  );
  const portableLoaderPath = fileURLToPath(
    new URL("./ssr-entry-loader.mjs", import.meta.url),
  );
  const remotesPlugin: RuntimePluginEntry = [
    fileURLToPath(new URL("./rspack-remotes.mjs", import.meta.url)),
    resolveRspackRemoteOptions(options.config?.remotes),
  ];
  const clientRuntimePlugins = injectRuntimePlugin(
    removeSsrEntryLoader(options.config?.runtimePlugins),
    sharedStrategyPath,
  );
  injectRuntimePlugin(clientRuntimePlugins, remotesPlugin);
  registerRspackClientOutput(options, exposed);

  addRspackPlugin(
    () =>
      new ModuleFederationPlugin(
        resolveRspackFederationOptions(options, exposed, rootDir, {
          manifestSsrEntry: Boolean(useNuxt().options.ssr),
          runtimePlugins: clientRuntimePlugins,
        }),
      ),
    { server: false },
  );

  registerRspackDevAssets(useNuxt(), options);
  registerServerFederationRuntimeBundling(
    options.config,
    resolveRspackPackageDependency("@module-federation/vite/ssrEntryLoader"),
    portableLoaderPath,
    nativeServerVue,
  );
  registerRspackServerExposesPublisher(useNuxt(), options, exposed);

  const loader = resolveSsrLoaderOptions(options, rootDir);
  const serverRuntimePlugins = injectRuntimePlugin(
    loader.remainingRuntimePlugins,
    sharedStrategyPath,
  );
  injectRuntimePlugin(serverRuntimePlugins, remotesPlugin);
  if (enableSsrRemoteLoader) {
    serverRuntimePlugins.push([portableLoaderPath, loader.options]);
    registerNitroTraceIncludes([
      ...loader.traceIncludes,
      ...(await resolveTraceIncludes(loader.tracePackages, rootDir)),
    ]);
  }

  addRspackPlugin(
    () =>
      new ModuleFederationPlugin(
        resolveRspackFederationOptions(options, exposed, rootDir, {
          asyncStartup: false,
          filename: resolveSsrRemoteEntryFileName(
            resolveRemoteEntryFileName(options),
          ),
          library: { type: "module" },
          manifest: false,
          remoteType: "script",
          runtimePlugins: serverRuntimePlugins,
          shared: resolveServerShared(options.config?.shared, nativeServerVue),
          target: "node",
        }),
      ),
    { client: false },
  );
}

function registerRspackClientOutput(
  options: ModuleOptions,
  exposed: Record<string, string>,
) {
  const nuxt = useNuxt();
  const buildAssetsPath = posix
    .join(nuxt.options.app.baseURL, nuxt.options.app.buildAssetsDir)
    .replace(/\/?$/, "/");
  extendRspackConfig(
    (config) => {
      config.output ??= {};
      if (options.config?.publicPath !== undefined) {
        config.output.publicPath = options.config.publicPath;
      }
      if (nuxt.options.dev) {
        config.module ??= {};
        config.module.rules ??= [];
        config.module.rules.push({
          test: /[/\\]@rsbuild[/\\]core[/\\]dist[/\\]client[/\\]hmr\.js$/,
          use: [
            fileURLToPath(new URL("./rspack-hmr-loader.mjs", import.meta.url)),
          ],
        });
      }
      if (!hasExposedModules(exposed, options.config)) return;
      config.output.publicPath = options.config?.publicPath ?? "auto";
      // A remote entry must bootstrap without first executing Nuxt's app entry.
      config.optimization ??= {};
      config.optimization.runtimeChunk = false;
      if (
        options.config?.publicPath !== undefined ||
        options.config?.getPublicPath
      )
        return;

      config.plugins ??= [];
      config.plugins.push({
        apply(compiler) {
          const { RuntimeGlobals, RuntimeModule } = compiler.webpack;
          class FederationPublicPathRuntimeModule extends RuntimeModule {
            constructor() {
              // Rspack only accepts its named runtime stages. Automatic public
              // path runs at STAGE_ATTACH, before this final initialization.
              super("nuxt federation public path", RuntimeModule.STAGE_TRIGGER);
            }

            override generate() {
              return `${RuntimeGlobals.publicPath} = new URL(${JSON.stringify(buildAssetsPath)}, ${RuntimeGlobals.publicPath}).href;`;
            }
          }

          compiler.hooks.thisCompilation.tap(
            "NuxtFederationPublicPath",
            (compilation) => {
              compilation.hooks.additionalTreeRuntimeRequirements.tap(
                "NuxtFederationPublicPath",
                (chunk, runtimeRequirements) => {
                  runtimeRequirements.add(RuntimeGlobals.publicPath);
                  compilation.addRuntimeModule(
                    chunk,
                    new FederationPublicPathRuntimeModule(),
                  );
                },
              );
            },
          );
        },
      });
    },
    { server: false },
  );
}

function registerServerFederationRuntimeBundling(
  federationConfig: ModuleOptions["config"],
  viteSsrEntryLoaderPath: string,
  portableLoaderPath: string,
  nativeServerVue: boolean,
) {
  const nuxt = useNuxt();
  const remoteNames = new Set(Object.keys(federationConfig?.remotes || {}));
  const ssrExternals = (federationConfig?.ssrExternals || []).filter(isString);
  const viteSsrEntryLoaderDir = dirname(dirname(viteSsrEntryLoaderPath));
  const viteRuntimeImportLoaderPath = fileURLToPath(
    new URL("./rspack-vite-loader.mjs", import.meta.url),
  );

  extendRspackConfig(
    (config) => {
      config.output ??= {};
      config.output.chunkFormat = "module";
      config.output.chunkLoading = "import";
      config.resolve ??= {};
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        "@module-federation/vite/ssrEntryLoader$": viteSsrEntryLoaderPath,
      };
      config.module ??= {};
      config.module.rules ??= [];
      if (!nuxt.options.dev) {
        config.module.rules.push({
          include: realpathSync(portableLoaderPath),
          // Production resolves traced dependencies beside the deployed bundle.
          // Dev still needs this package's own dependencies under strict pnpm.
          parser: { importMeta: false },
        });
      }
      config.module.rules.push({
        include: viteSsrEntryLoaderDir,
        test: /\.[cm]?js$/,
        use: [viteRuntimeImportLoaderPath],
        // In dev, the Vite runner resolves its peer from the installed loader.
        // Production entry loading must resolve beside the deployed bundle.
        ...(!nuxt.options.dev ? { parser: { importMeta: false } } : {}),
      });
      config.plugins ??= [];
      config.plugins.push(
        new NuxtRspackServerChunkLoadingPlugin() as NonNullable<
          typeof config.plugins
        >[number],
      );

      const externals = config.externals
        ? Array.isArray(config.externals)
          ? config.externals
          : [config.externals]
        : [];

      config.externals = [
        ({ request }: { request?: string }) => {
          const vueExternal =
            nativeServerVue && request && resolveServerVueExternal(request);
          if (vueExternal) return `module ${vueExternal}`;
          if (
            request &&
            ssrExternals.some(
              (packageName) =>
                request === packageName ||
                request.startsWith(`${packageName}/`),
            )
          ) {
            // Keep explicit SSR externals portable and use their ESM export
            // conditions when the consuming host imports the published graph.
            return `module ${request}`;
          }
          if (
            request === "@module-federation/vite/ssrEntryLoader" ||
            request === viteSsrEntryLoaderPath
          ) {
            return false;
          }
          if (
            request?.includes("!=!data:text/javascript") ||
            request?.startsWith("webpack/container/reference/") ||
            [...remoteNames].some((name) => request?.startsWith(`${name}/`))
          ) {
            return false;
          }
          return undefined;
        },
        ...externals,
      ];
    },
    { client: false },
  );
}

interface RspackCompilerWithRuntimeHooks {
  hooks: {
    compilation: {
      tap(
        name: string,
        handler: (compilation: RspackCompilationWithRuntimeHooks) => void,
      ): void;
    };
  };
  webpack: {
    Compilation: {
      PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE: number;
    };
    sources: {
      RawSource: new (source: string) => unknown;
    };
  };
}

interface RspackCompilationWithRuntimeHooks {
  chunks: Iterable<RspackChunk>;
  hooks: {
    processAssets: {
      tap(
        options: { name: string; stage: number },
        handler: (assets: Record<string, RspackSource>) => void,
      ): void;
    };
  };
}

interface RspackChunk {
  canBeInitial(): boolean;
  files: Iterable<string>;
  getAllAsyncChunks(): Iterable<RspackChunk>;
  id?: number | string | null;
}

interface RspackSource {
  source(): ArrayBuffer | string | Uint8Array;
}

class NuxtRspackServerChunkLoadingPlugin {
  apply(compiler: RspackCompilerWithRuntimeHooks) {
    compiler.hooks.compilation.tap(
      "NuxtRspackServerChunkLoadingPlugin",
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: "NuxtRspackServerChunkLoadingPlugin",
            stage:
              compiler.webpack.Compilation
                .PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE - 1,
          },
          (assets) => {
            const availableFiles = new Set(Object.keys(assets));

            for (const [fileName, asset] of Object.entries(assets)) {
              if (!/\.[cm]?js$/.test(fileName)) continue;
              const chunkLoaders = collectRspackServerChunkLoaders(
                compilation,
                fileName,
              );

              const source = patchRspackServerChunkLoading(
                sanitizeRspackServerSource(
                  String(asset.source()),
                  fileName,
                  (dependency) => availableFiles.has(dependency),
                ),
                chunkLoaders,
              );
              assets[fileName] = new compiler.webpack.sources.RawSource(
                source,
              ) as RspackSource;
            }
          },
        );
      },
    );
  }
}

function collectRspackServerChunkLoaders(
  compilation: RspackCompilationWithRuntimeHooks,
  fileName: string,
) {
  const loaders: Array<[number | string, string]> = [];
  const runtimeChunk = [...compilation.chunks].find((chunk) =>
    [...chunk.files].includes(fileName),
  );
  for (const chunk of runtimeChunk?.getAllAsyncChunks() || []) {
    if (chunk.canBeInitial() || chunk.id == null) continue;

    const fileName = [...chunk.files].find((file) => /\.[cm]?js$/.test(file));
    if (fileName) loaders.push([chunk.id, fileName]);
  }
  return loaders;
}

function resolveRspackFederationOptions(
  options: ModuleOptions,
  exposed: Record<string, string>,
  rootDir: string,
  overrides: {
    asyncStartup?: boolean;
    filename?: string;
    library?: RspackFederationOptions["library"];
    manifest?: RspackFederationOptions["manifest"];
    manifestSsrEntry?: boolean;
    remoteType?: RspackFederationOptions["remoteType"];
    runtimePlugins?: RuntimePluginEntry[];
    shared?: RspackFederationOptions["shared"];
    target?: "node" | "web";
  } = {},
): RspackFederationOptions {
  const config = options.config as Partial<RspackFederationOptions> | undefined;
  const experiments = config?.experiments;

  return {
    async: config?.async,
    bridge: config?.bridge,
    dev: config?.dev,
    dts: config?.dts ?? false,
    experiments: {
      externalRuntime: experiments?.externalRuntime,
      provideExternalRuntime: experiments?.provideExternalRuntime,
      asyncStartup: overrides.asyncStartup ?? experiments?.asyncStartup ?? true,
      optimization: {
        ...experiments?.optimization,
        ...(overrides.target ? { target: overrides.target } : {}),
      },
    },
    filename: overrides.filename || config?.filename || "remoteEntry.js",
    getPublicPath: config?.getPublicPath,
    implementation: config?.implementation,
    injectTreeShakingUsedExports: config?.injectTreeShakingUsedExports,
    library: overrides.library || config?.library,
    manifest:
      overrides.manifest === false
        ? false
        : resolveManifestOptions(
            options,
            overrides.manifestSsrEntry && hasExposedModules(exposed, config),
          ),
    name: config?.name || "remote",
    remotes: normalizeRspackRemotes(options.config?.remotes),
    remoteType: overrides.remoteType || config?.remoteType,
    runtime: config?.runtime,
    runtimePlugins: overrides.runtimePlugins || config?.runtimePlugins,
    shareScope: config?.shareScope,
    // Initialize the host's Vue before a development remote consumes its shares.
    // Per-share strategy alone cannot override the runtime's version-first init.
    shareStrategy: config?.shareStrategy ?? "loaded-first",
    shared: overrides.shared || config?.shared,
    treeShakingDir: config?.treeShakingDir,
    treeShakingSharedExcludePlugins: config?.treeShakingSharedExcludePlugins,
    treeShakingSharedPlugins: config?.treeShakingSharedPlugins,
    virtualRuntimeEntry: config?.virtualRuntimeEntry,
    exposes: {
      ...normalizeExposePaths(exposed, rootDir),
      ...normalizeExposePaths(config?.exposes, rootDir),
    },
  };
}

function resolveServerShared(
  shared: RspackFederationOptions["shared"],
  nativeServerVue: boolean,
) {
  if (Array.isArray(shared)) {
    return Object.fromEntries(
      shared
        .filter(
          (packageName) =>
            !nativeServerVue ||
            typeof packageName !== "string" ||
            !resolveServerVueExternal(packageName),
        )
        .map((packageName) => [packageName, { eager: true }]),
    );
  }
  if (!isJsonObject(shared)) return shared;

  return Object.fromEntries(
    Object.entries(shared)
      .filter(
        ([packageName]) =>
          !nativeServerVue || !resolveServerVueExternal(packageName),
      )
      .map(([packageName, config]) => [
        packageName,
        typeof config === "string"
          ? resolveServerSharedShorthand(packageName, config)
          : { ...config, eager: true },
      ]),
  ) as RspackFederationOptions["shared"];
}

function resolveServerSharedShorthand(packageName: string, value: string) {
  return value !== packageName && isVersionShorthand(value)
    ? { eager: true, import: packageName, requiredVersion: value }
    : { eager: true, import: value };
}

function resolveManifestOptions(
  options: ModuleOptions,
  includeSsrEntry = false,
): RspackFederationOptions["manifest"] {
  if (options.config?.manifest === false) return false;

  const configured = (
    options.config?.manifest && typeof options.config.manifest !== "boolean"
      ? options.config.manifest
      : {}
  ) as RspackManifestOptions;
  const configuredAdditionalData = configured.additionalData;
  const metadata = resolveManifestMetadata(options);
  const ssrEntry = includeSsrEntry
    ? resolveSsrRemoteEntryFileName(resolveRemoteEntryFileName(options))
    : undefined;
  const manifestFile = resolveManifestFileName(options);
  const nuxt = useNuxt();
  const buildAssetsDir = nuxt.options.app.buildAssetsDir.replace(
    /^\/+|\/+$/g,
    "",
  );
  const manifestDirectory = posix.dirname(
    posix.join(normalizeBase(options.base), manifestFile),
  );
  const devAssetPrefix = posix.relative(
    manifestDirectory,
    posix.join(nuxt.options.app.baseURL, nuxt.options.app.buildAssetsDir),
  );

  return {
    fileName: "mf-manifest.json",
    ...configured,
    async additionalData(context) {
      const configuredStats = await configuredAdditionalData?.(context);
      const stats = configuredStats || context.stats;
      const metaData = stats.metaData as typeof stats.metaData & {
        custom?: Record<string, unknown>;
        publicPath?: string;
        ssrRemoteEntry?: { name: string; path: string; type: string };
      };

      if (
        options.config?.publicPath === undefined &&
        !options.config?.getPublicPath
      ) {
        metaData.publicPath = "auto";
        for (const entry of [
          ...(stats.exposes || []),
          ...(stats.shared || []),
        ]) {
          for (const type of ["js", "css"] as const) {
            for (const mode of ["sync", "async"] as const) {
              const assets = entry.assets?.[type]?.[mode];
              if (!assets) continue;
              entry.assets[type][mode] = assets.map((asset) =>
                posix.join(
                  nuxt.options.dev ? devAssetPrefix : buildAssetsDir,
                  asset,
                ),
              );
            }
          }
        }
      }

      if (ssrEntry) {
        metaData.ssrRemoteEntry = {
          name: posix.basename(ssrEntry),
          path: resolveManifestEntryPath(manifestFile, ssrEntry),
          type: "module",
        };
      }
      if (Object.keys(metadata).length > 0) {
        metaData.custom = { ...metaData.custom, ...metadata };
      }

      return stats;
    },
  };
}

function resolveManifestEntryPath(manifestFile: string, entryFile: string) {
  const relative = posix.relative(
    posix.dirname(manifestFile),
    posix.dirname(entryFile),
  );

  return relative && relative !== "." ? `${relative}/` : "";
}

function resolveSsrLoaderOptions(options: ModuleOptions, rootDir: string) {
  const configuredLoader = options.config?.runtimePlugins?.find(
    (plugin) => runtimePluginSpecifier(plugin) === SSR_ENTRY_LOADER_PLUGIN,
  );
  const configuredOptions =
    Array.isArray(configuredLoader) && isJsonObject(configuredLoader[1])
      ? configuredLoader[1]
      : {};
  const sharedPackages = getSharedPackageNames(options.config?.shared);
  const locallyProvidedSharedPackages = getLocallyProvidedSharedPackageNames(
    options.config?.shared,
  );
  const configuredExternals = (options.config?.ssrExternals || []).filter(
    isString,
  );
  const portableShared = createPortableResolvedShared(
    configuredOptions.resolvedShared,
    rootDir,
  );
  const runtimePackages = mergeSsrRuntimePackageNames(
    configuredOptions.runtimePackages,
    selectSsrRuntimePackageNames(COMMON_SSR_PACKAGES, sharedPackages),
  );
  const requiredPackages = mergeSsrRequiredPackageNames(
    configuredOptions.requiredPackages,
    [
      ...COMMON_SSR_PACKAGES,
      ...locallyProvidedSharedPackages,
      ...getImportFalseSharedPackageNames(options.config?.shared),
      ...NUXT_SSR_SHARED_PACKAGES.filter((name) => sharedPackages.has(name)),
      ...configuredExternals,
    ],
  );
  const {
    requiredPackages: _configuredRequiredPackages,
    resolvedShared: _configuredResolvedShared,
    runtimePackages: _configuredRuntimePackages,
    sharedPackages: _legacySharedPackages,
    ...portableOptions
  } = configuredOptions;

  return {
    options: {
      ...portableOptions,
      configuredRemoteEntries: resolveConfiguredRemoteEntries(
        options.config?.remotes,
      ),
      fetchTimeoutMs: options.ssrFetchTimeoutMs,
      hostName: options.config?.name || "remote",
      maxAgeMs: options.ssrManifestMaxAgeMs,
      ...(Object.keys(portableShared.mappings).length > 0
        ? { portableResolvedShared: portableShared.mappings }
        : {}),
      requiredPackages,
      runtimePackages,
    },
    remainingRuntimePlugins: removeSsrEntryLoader(
      options.config?.runtimePlugins,
    ),
    traceIncludes: portableShared.traceIncludes,
    tracePackages: [...new Set([...requiredPackages, ...runtimePackages])],
  };
}

function resolveConfiguredRemoteEntries(
  remotes: NonNullable<ModuleOptions["config"]>["remotes"],
) {
  if (!remotes || Array.isArray(remotes)) return {};

  return Object.fromEntries(
    Object.entries(remotes).flatMap(([name, remote]) => {
      const entry = resolveRemoteEntry(remote);
      return entry ? [[name, entry]] : [];
    }),
  );
}

function removeSsrEntryLoader(
  plugins: RspackFederationOptions["runtimePlugins"] | undefined,
) {
  return (plugins || []).filter(
    (plugin) => runtimePluginSpecifier(plugin) !== SSR_ENTRY_LOADER_PLUGIN,
  );
}

function injectRuntimePlugin(
  plugins: RuntimePluginEntry[],
  plugin: RuntimePluginEntry,
) {
  const specifier = runtimePluginSpecifier(plugin);
  if (!plugins.some((entry) => runtimePluginSpecifier(entry) === specifier)) {
    plugins.push(plugin);
  }
  return plugins;
}

function runtimePluginSpecifier(plugin: RuntimePluginEntry) {
  return typeof plugin === "string" ? plugin : plugin[0];
}

function normalizeExposePaths(
  exposes: RspackFederationOptions["exposes"] | undefined,
  rootDir: string,
) {
  if (!isJsonObject(exposes)) return exposes;

  return Object.fromEntries(
    Object.entries(exposes).map(([key, value]) => {
      if (typeof value === "string") {
        return [key, normalizeExposeImportPath(value, rootDir)];
      }
      if (Array.isArray(value) && value.every(isString)) {
        return [
          key,
          value.map((importPath) =>
            normalizeExposeImportPath(importPath, rootDir),
          ),
        ];
      }
      if (
        isJsonObject(value) &&
        (typeof value.import === "string" ||
          (Array.isArray(value.import) && value.import.every(isString)))
      ) {
        return [
          key,
          {
            ...value,
            import: Array.isArray(value.import)
              ? value.import.map((importPath) =>
                  normalizeExposeImportPath(importPath, rootDir),
                )
              : normalizeExposeImportPath(value.import, rootDir),
          },
        ];
      }
      return [key, value];
    }),
  ) as RspackFederationOptions["exposes"];
}

function normalizeExposeImportPath(importPath: string, rootDir: string) {
  return importPath.startsWith(".") ? resolve(rootDir, importPath) : importPath;
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

function hasRemotes(config: ModuleOptions["config"]) {
  return Boolean(config?.remotes && Object.keys(config.remotes).length > 0);
}

function hasExposedModules(
  exposed: Record<string, string>,
  config: { exposes?: unknown } | undefined,
) {
  return (
    Object.keys(exposed).length > 0 ||
    Boolean(config?.exposes && Object.keys(config.exposes).length > 0)
  );
}

async function resolveTraceIncludes(packageNames: string[], rootDir: string) {
  const paths: string[] = [];
  for (const packageName of packageNames) {
    if (isBuiltin(packageName)) continue;

    const path = COMMON_SSR_PACKAGES.includes(packageName)
      ? resolveRspackPackageDependency(packageName)
      : await resolvePath(packageName, { cwd: rootDir });
    if (!existsSync(path)) {
      throw new Error(
        `[module-federation] Cannot resolve SSR dependency "${packageName}" from ${rootDir}. Install it in the Nuxt application.`,
      );
    }
    paths.push(path);
  }
  return paths;
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

function isString(value: unknown): value is string {
  return typeof value === "string";
}
