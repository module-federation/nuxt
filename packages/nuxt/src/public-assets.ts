import type { HookResult, Nuxt } from "@nuxt/schema";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, posix, resolve } from "node:path";
import {
  resolveManifestFileName,
  resolveRemoteEntryFileName,
  resolveSsrRemoteEntryFileName,
} from "./federation-paths";
import { isJsonObject, parseJsonObject } from "./json";
import type { ModuleOptions } from "./options";

type NitroPublicAssetsContext = {
  options: {
    buildDir: string;
    output: {
      publicDir: string;
    };
  };
};

declare module "@nuxt/schema" {
  interface NuxtHooks {
    "nitro:build:public-assets": (
      nitro: NitroPublicAssetsContext,
    ) => HookResult;
  }
}

export function registerRemoteEntryAssetCopy(
  nuxt: Nuxt,
  publicBase: string,
  options: ModuleOptions,
) {
  const outputBase = publicBase.replace(/^\//, "");
  const remoteEntryFile = resolveRemoteEntryFileName(options);
  const ssrRemoteEntryFile = resolveSsrRemoteEntryFileName(remoteEntryFile);
  const manifestFile = resolveManifestFileName(options);
  const remoteEntryFiles = [remoteEntryFile, ssrRemoteEntryFile, manifestFile];

  // Nuxt only copies the _nuxt/ subfolder from dist/client/ to .output/public/.
  // Federation entries are moved under publicBase, so their root-relative chunk
  // imports must be rebased back to Nuxt's public _nuxt/ directory.
  nuxt.hook("nitro:build:public-assets", (nitro) => {
    for (const file of remoteEntryFiles) {
      const src = resolve(nitro.options.buildDir, `dist/client/${file}`);
      const dest = resolve(nitro.options.output.publicDir, outputBase, file);

      if (existsSync(src)) {
        ensureParentDir(dest);

        if (file === remoteEntryFile) {
          copyOriginalRemoteEntryAsset(
            src,
            nitro.options.output.publicDir,
            remoteEntryFile,
            outputBase,
          );
        }

        if (file === manifestFile) {
          writeFileSync(
            dest,
            rebaseFederationManifest(
              readFileSync(src, "utf8"),
              outputBase,
              manifestFile,
              remoteEntryFile,
              ssrRemoteEntryFile,
            ),
          );
        } else if (shouldRebaseNuxtClientImports(file, outputBase)) {
          writeFileSync(
            dest,
            rebaseNuxtClientImports(
              readFileSync(src, "utf8"),
              outputBase,
              file,
            ),
          );
        } else {
          cpSync(src, dest);
        }
      }
    }
  });
}

function copyOriginalRemoteEntryAsset(
  src: string,
  publicDir: string,
  remoteEntryFile: string,
  outputBase: string,
) {
  if (!outputBase) return;

  const dest = resolve(publicDir, remoteEntryFile);
  ensureParentDir(dest);
  cpSync(src, dest);
}

function ensureParentDir(path: string) {
  mkdirSync(dirname(path), { recursive: true });
}

function shouldRebaseNuxtClientImports(file: string, outputBase: string) {
  return (
    outputBase.length > 0 && (file.endsWith(".js") || file.endsWith(".mjs"))
  );
}

function rebaseNuxtClientImports(
  source: string,
  outputBase: string,
  file: string,
) {
  const depth = [outputBase, dirname(file)]
    .flatMap((path) => path.split("/"))
    .filter((part) => part && part !== ".").length;
  const prefix = "../".repeat(depth);

  return source.replace(/(["'`])\.\/_nuxt\//g, `$1${prefix}_nuxt/`);
}

function rebaseFederationManifest(
  source: string,
  outputBase: string,
  manifestFile: string,
  remoteEntryFile: string,
  ssrRemoteEntryFile: string,
) {
  const manifest = parseJsonObject(source);
  if (!manifest) return source;

  const metaData = isJsonObject(manifest.metaData) ? manifest.metaData : {};
  manifest.metaData = metaData;

  rebaseManifestEntry(
    metaData.remoteEntry,
    outputBase,
    manifestFile,
    remoteEntryFile,
  );
  rebaseManifestEntry(
    metaData.ssrRemoteEntry,
    outputBase,
    manifestFile,
    ssrRemoteEntryFile,
  );

  if (shouldUseAutoPublicPath(metaData.publicPath)) {
    metaData.publicPath = "auto";
  }

  const publicRootPrefix = resolveRelativeUrl(
    manifestPublicDir(outputBase, manifestFile),
    "",
  );

  for (const expose of getManifestExposeEntries(manifest)) {
    rebaseManifestAssetGroup(expose.assets, publicRootPrefix);
  }

  return JSON.stringify(manifest);
}

function rebaseManifestEntry(
  entry: unknown,
  outputBase: string,
  manifestFile: string,
  entryFile: string,
) {
  if (!isJsonObject(entry)) return;

  entry.name = posix.basename(entryFile);
  entry.path = resolveRelativeUrl(
    manifestPublicDir(outputBase, manifestFile),
    publicFileDir(outputBase, entryFile),
  );
}

function getManifestExposeEntries(manifest: Record<string, unknown>) {
  return Array.isArray(manifest.exposes)
    ? manifest.exposes.filter(isJsonObject)
    : [];
}

function rebaseManifestAssetGroup(assets: unknown, publicRootPrefix: string) {
  if (!isJsonObject(assets)) return;

  for (const type of ["js", "css"]) {
    const group = assets[type];
    if (!isJsonObject(group)) continue;

    for (const loadType of ["sync", "async"]) {
      const assetList = group[loadType];
      if (!Array.isArray(assetList)) continue;

      group[loadType] = assetList.map((asset) =>
        typeof asset === "string" && isNuxtAsset(asset)
          ? `${publicRootPrefix}${stripRelativePrefix(asset)}`
          : asset,
      );
    }
  }
}

function shouldUseAutoPublicPath(publicPath: unknown) {
  return (
    typeof publicPath === "string" &&
    (publicPath === "" || publicPath === "." || publicPath.startsWith("./"))
  );
}

function isNuxtAsset(asset: string) {
  const normalized = stripRelativePrefix(asset);
  return normalized.startsWith("_nuxt/");
}

function stripRelativePrefix(value: string) {
  return value.replace(/^\.\/+/, "");
}

function manifestPublicDir(outputBase: string, manifestFile: string) {
  return publicFileDir(outputBase, manifestFile);
}

function publicFileDir(outputBase: string, file: string) {
  return normalizePublicPath(posix.dirname(posix.join(outputBase, file)));
}

function resolveRelativeUrl(fromDir: string, toPath: string) {
  const normalizedTo = normalizePublicPath(toPath);
  const relative = posix.relative(fromDir, normalizedTo);

  if (!relative) return "";
  return relative.endsWith("/") ? relative : `${relative}/`;
}

function normalizePublicPath(path: string) {
  return path === "." ? "" : path.replace(/^\/+/, "");
}
