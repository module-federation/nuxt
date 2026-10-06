import type { ModuleFederationOptions } from "@module-federation/vite";
import { addTemplate, type useNuxt } from "@nuxt/kit";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";

type Nuxt = ReturnType<typeof useNuxt>;
type DtsOption = ModuleFederationOptions["dts"];
type PluginDtsOptions = Exclude<NonNullable<DtsOption>, boolean>;
type DtsRemoteOptions = Exclude<
  NonNullable<PluginDtsOptions["generateTypes"]>,
  boolean
>;
type DtsHostOptions = Exclude<
  NonNullable<PluginDtsOptions["consumeTypes"]>,
  boolean
>;

const DEFAULT_TYPES_FOLDER = "@mf-types";
const DTS_TSCONFIG_FILE = "tsconfig.mf-types.json";

export interface NuxtDtsPaths {
  buildDir: string;
  rootDir: string;
  srcDir: string;
}

/**
 * Fill MF dts defaults that only make sense for Nuxt. The MF Vite plugin
 * resolves dts paths from the Vite root, which Nuxt points at `srcDir`, so
 * relative paths are rebased onto `rootDir` where users expect them.
 */
export function resolveNuxtDtsOptions(
  dts: DtsOption,
  paths: NuxtDtsPaths,
  hasVueTsc = canResolveVueTsc(paths.rootDir),
): PluginDtsOptions | false {
  if (!dts) return false;

  const options: PluginDtsOptions = dts === true ? {} : dts;

  return {
    ...options,
    cwd: resolve(paths.rootDir, options.cwd || "."),
    generateTypes: resolveGenerateTypes(options, paths, hasVueTsc),
    consumeTypes: resolveConsumeTypes(options.consumeTypes, paths),
  };
}

function resolveGenerateTypes(
  options: PluginDtsOptions,
  paths: NuxtDtsPaths,
  hasVueTsc: boolean,
): DtsRemoteOptions | false {
  if (options.generateTypes === false) return false;

  const generateTypes: DtsRemoteOptions =
    options.generateTypes === true ? {} : options.generateTypes || {};
  const tsConfigPath = generateTypes.tsConfigPath || options.tsConfigPath;

  return {
    ...(hasVueTsc ? { compilerInstance: "vue-tsc" } : {}),
    ...generateTypes,
    tsConfigPath: tsConfigPath
      ? resolve(paths.rootDir, tsConfigPath)
      : join(paths.buildDir, DTS_TSCONFIG_FILE),
  };
}

function resolveConsumeTypes(
  consumeTypes: PluginDtsOptions["consumeTypes"],
  paths: NuxtDtsPaths,
): DtsHostOptions | false {
  if (consumeTypes === false) return false;

  const options: DtsHostOptions =
    consumeTypes === true ? {} : consumeTypes || {};

  return {
    ...options,
    // MF joins this onto the Vite root, so it must stay relative.
    typesFolder: relative(
      paths.srcDir,
      resolveConsumedTypesDir(consumeTypes, paths),
    )
      .split(sep)
      .join("/"),
  };
}

function resolveConsumedTypesDir(
  consumeTypes: PluginDtsOptions["consumeTypes"],
  paths: Pick<NuxtDtsPaths, "rootDir">,
) {
  const typesFolder =
    typeof consumeTypes === "object" && consumeTypes.typesFolder
      ? consumeTypes.typesFolder
      : DEFAULT_TYPES_FOLDER;

  return resolve(paths.rootDir, typesFolder);
}

/** Public file names the MF dts plugin emits next to the remote entry. */
export function resolveGeneratedTypesFileNames(dts: DtsOption) {
  if (!dts) return [];
  if (typeof dts === "object" && dts.generateTypes === false) return [];

  const typesFolder =
    typeof dts === "object" &&
    typeof dts.generateTypes === "object" &&
    dts.generateTypes.typesFolder
      ? dts.generateTypes.typesFolder
      : DEFAULT_TYPES_FOLDER;

  return [`${typesFolder}.zip`, `${typesFolder}.d.ts`];
}

export function registerDtsTemplates(
  nuxt: Nuxt,
  dts: DtsOption,
  remoteNames: string[],
) {
  const options = resolveNuxtDtsOptions(dts, nuxt.options);
  if (!options) return;

  if (options.generateTypes) {
    // MF infers the declaration root from the tsconfig's own files, which in
    // Nuxt are only `.d.ts` files. Pin it to a directory containing every
    // layer and keep the incremental build info out of `srcDir`, where MF
    // would put it.
    const declarationRoot = findCommonDir([
      nuxt.options.rootDir,
      nuxt.options.srcDir,
      ...nuxt.options._layers.map((layer) => layer.config.rootDir),
    ]);

    addTemplate({
      filename: DTS_TSCONFIG_FILE,
      write: true,
      getContents: () =>
        JSON.stringify(
          {
            extends: "./tsconfig.app.json",
            compilerOptions: {
              rootDir: declarationRoot,
              tsBuildInfoFile: join(
                nuxt.options.rootDir,
                "node_modules/.cache/mf-types/.tsbuildinfo",
              ),
            },
          },
          null,
          2,
        ),
    });
  }

  if (options.consumeTypes && remoteNames.length > 0) {
    const typesDir = resolveConsumedTypesDir(
      typeof dts === "object" ? dts.consumeTypes : undefined,
      nuxt.options,
    );

    nuxt.hook("prepare:types", ({ tsConfig }) => {
      tsConfig.compilerOptions ||= {};
      tsConfig.compilerOptions.paths ||= {};

      for (const remoteName of remoteNames) {
        tsConfig.compilerOptions.paths[`${remoteName}/*`] = [
          join(typesDir, remoteName, "*"),
        ];
      }
    });
  }
}

function findCommonDir(paths: string[]) {
  return paths.reduce((common, path) => {
    while (relative(common, path).startsWith("..")) common = dirname(common);
    return common;
  });
}

function canResolveVueTsc(rootDir: string) {
  try {
    createRequire(join(rootDir, "package.json")).resolve(
      "vue-tsc/package.json",
    );
    return true;
  } catch {
    return false;
  }
}
