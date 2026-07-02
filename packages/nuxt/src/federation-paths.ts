import { posix } from "node:path";
import type { ModuleOptions } from "./options";

export function resolveRemoteEntryFileName(options: ModuleOptions) {
  return typeof options.config?.filename === "string"
    ? normalizeAssetPath(options.config.filename)
    : "remoteEntry.js";
}

export function resolveSsrRemoteEntryFileName(remoteEntry: string) {
  const parsed = posix.parse(remoteEntry);
  const fileName = parsed.ext
    ? `${parsed.name}.ssr${parsed.ext}`
    : `${parsed.base}.ssr.js`;

  return parsed.dir ? posix.join(parsed.dir, fileName) : fileName;
}

export function resolveFederationAssetFileNames(options: ModuleOptions) {
  const remoteEntryFile = resolveRemoteEntryFileName(options);
  const files = [
    remoteEntryFile,
    resolveSsrRemoteEntryFileName(remoteEntryFile),
  ];

  if (options.config?.manifest !== false) {
    files.push(resolveManifestFileName(options));
  }

  return files;
}

export function resolveManifestFileName(options: ModuleOptions) {
  if (
    options.config?.manifest &&
    typeof options.config.manifest !== "boolean"
  ) {
    return normalizeAssetPath(
      posix.join(
        options.config.manifest.filePath || "",
        options.config.manifest.fileName || "mf-manifest.json",
      ),
    );
  }

  return "mf-manifest.json";
}

export function getStatsFileName(manifestFileName: string) {
  const parsed = posix.parse(manifestFileName);
  const fileExt = parsed.ext || ".json";
  const baseName = parsed.ext ? parsed.name : parsed.base;
  const fileName = `${baseName === "mf-manifest" ? "mf" : baseName}-stats${fileExt}`;

  return parsed.dir ? posix.join(parsed.dir, fileName) : fileName;
}

function normalizeAssetPath(path: string) {
  return path.split("\\").join("/");
}
