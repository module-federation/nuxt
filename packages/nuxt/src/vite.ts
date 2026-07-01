import { federation } from "@module-federation/vite";
import { addVitePlugin } from "@nuxt/kit";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { getStatsFileName, resolveManifestFileName } from "./federation-paths";
import { isJsonObject, parseJsonObject } from "./json";
import type { ModuleOptions } from "./options";

const NUXT_SSR_ESM_EXTERNALS = ["vue", "vue-router"];
const COMMON_SSR_SHARED_PACKAGES = [
  "@module-federation/runtime",
  "@module-federation/runtime-core",
  "@module-federation/sdk",
];
type FederationConfig = NonNullable<ModuleOptions["config"]>;
type SharedConfig = FederationConfig["shared"];

export function registerFederationPlugin(
  options: ModuleOptions,
  exposed: Record<string, string>,
  rootDir = process.cwd(),
  ssrOptions: { server?: boolean } = {},
) {
  const enableServerFederation = ssrOptions.server !== false;
  const ssrShared = resolveSsrShared(options, rootDir);

  addVitePlugin(
    () => federation(createFederationConfig(options, exposed, rootDir)),
    {
      server: false,
    },
  );

  registerServerCommonJsInteropPlugin(ssrShared.esmExternals);

  addVitePlugin(
    () =>
      federation(
        createFederationConfig(
          {
            ...options,
            config: enableServerFederation
              ? withSsrEntryLoader(
                  {
                    ...options.config,
                    shared: {},
                    target: "node",
                  },
                  ssrShared.resolvedShared,
                )
              : {
                  ...options.config,
                  shared: {},
                  target: "node",
                },
          },
          exposed,
          rootDir,
        ),
      ),
    { client: false },
  );

  registerManifestMetadataPlugin(options);
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

function withSsrEntryLoader(
  config: ModuleOptions["config"],
  resolvedShared: Record<string, string>,
) {
  if (!config?.remotes || Object.keys(config.remotes).length === 0) {
    return config;
  }

  const ssrEntryLoader = "@module-federation/vite/ssrEntryLoader";
  const runtimePlugins = config.runtimePlugins || [];
  const hasSsrEntryLoader = runtimePlugins.some(
    (plugin) =>
      (typeof plugin === "string" ? plugin : plugin[0]) === ssrEntryLoader,
  );

  if (hasSsrEntryLoader) return config;

  return {
    ...config,
    runtimePlugins: [
      ...runtimePlugins,
      [ssrEntryLoader, { resolvedShared }] satisfies [
        string,
        Record<string, unknown>,
      ],
    ],
  };
}

function resolveSsrShared(options: ModuleOptions, rootDir: string) {
  const sharedPackages = getSharedPackageNames(options.config?.shared);
  const esmExternals = NUXT_SSR_ESM_EXTERNALS.filter((packageName) =>
    sharedPackages.has(packageName),
  );
  const appRequire = createRequire(resolve(rootDir, "package.json"));
  const moduleRequire = createRequire(import.meta.url);
  const pluginRequire = createVitePackageRequire(moduleRequire);
  const resolvedShared: Record<string, string> = {};

  for (const packageName of new Set([
    ...COMMON_SSR_SHARED_PACKAGES,
    ...sharedPackages,
    ...esmExternals,
  ])) {
    const resolved = resolvePackage(packageName, appRequire, pluginRequire);
    if (resolved) resolvedShared[packageName] = resolved;
  }

  return { esmExternals, resolvedShared };
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

function getSharedPackageNames(shared: SharedConfig | undefined) {
  if (Array.isArray(shared)) return new Set(shared);
  if (isJsonObject(shared)) return new Set(Object.keys(shared));

  return new Set<string>();
}

function registerServerCommonJsInteropPlugin(esmExternals: string[]) {
  if (esmExternals.length === 0) return;

  addVitePlugin(
    {
      name: "module-federation:nuxt:ssr-commonjs-esm-externals",
      apply: "build",
      config(config) {
        config.build ??= {};
        config.build.commonjsOptions ??= {};
        const commonjsOptions = config.build.commonjsOptions;
        commonjsOptions.esmExternals = mergeEsmExternals(
          commonjsOptions.esmExternals,
          esmExternals,
        );
      },
    },
    { client: false },
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
