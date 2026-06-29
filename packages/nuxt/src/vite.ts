import { federation } from "@module-federation/vite";
import { addVitePlugin } from "@nuxt/kit";
import { isJsonObject, parseJsonObject } from "./json";
import type { ModuleOptions } from "./options";

export function registerFederationPlugin(
  options: ModuleOptions,
  exposed: Record<string, string>,
) {
  addVitePlugin(
    () =>
      federation({
        dts: false,
        name: "remote",
        filename: "remoteEntry.js",
        manifest: resolveManifestOptions(options),
        ...options.config,
        exposes: {
          ...exposed,
          ...options.config?.exposes,
        },
      }),
    { server: false },
  );

  registerManifestMetadataPlugin(options);
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

function resolveManifestFileName(options: ModuleOptions) {
  if (
    options.config?.manifest &&
    typeof options.config.manifest !== "boolean"
  ) {
    return options.config.manifest.fileName || "mf-manifest.json";
  }

  return "mf-manifest.json";
}

function getStatsFileName(manifestFileName: string) {
  const dotIndex = manifestFileName.lastIndexOf(".");
  const ext = dotIndex === -1 ? ".json" : manifestFileName.slice(dotIndex);
  const withoutExt =
    dotIndex === -1 ? manifestFileName : manifestFileName.slice(0, dotIndex);
  const baseName = withoutExt === "mf-manifest" ? "mf" : withoutExt;

  return `${baseName}-stats${ext}`;
}
