import type { HookResult, Nuxt } from "@nuxt/schema";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";
import {
  getStatsFileName,
  resolveManifestFileName,
  resolveRemoteEntryFileName,
  resolveSsrRemoteEntryFileName,
} from "./federation-paths";
import type { ModuleOptions } from "./options";
import { createSsrOutputFingerprint } from "./server-output-fingerprint";
import { sanitizeJavaScriptComments } from "./javascript-comments";
import {
  assertPortableSsrOutputGraph,
  findModuleSpecifiers,
} from "./server-output-portability";
import { writeSsrOutputFingerprint } from "./server-exposes";

const RSPACK_SSR_GRAPH_DIR = "ssr";
const STRING_LITERAL_RE = /(["'])(?:\\[\s\S]|(?!\1)[^\\\r\n])*\1/g;

declare module "@nuxt/schema" {
  interface NuxtHooks {
    "nitro:build:before": () => HookResult;
  }
}

interface PublishedChunk {
  code: string;
  type: "chunk";
}

export function registerRspackServerExposesPublisher(
  nuxt: Nuxt,
  options: ModuleOptions,
  exposed: Record<string, string>,
) {
  if (nuxt.options.dev) return;

  const buildAssetsDir = normalizeBuildAssetsDir(
    nuxt.options.app.buildAssetsDir,
  );
  const clientOutDir = resolve(nuxt.options.buildDir, "dist/client");
  const serverOutDir = resolve(nuxt.options.buildDir, "dist/server");
  const entryFile = resolveSsrRemoteEntryFileName(
    resolveRemoteEntryFileName(options),
  );

  nuxt.hook("nitro:build:before", () => {
    if (
      Object.keys(exposed).length === 0 &&
      Object.keys(options.config?.exposes || {}).length === 0
    ) {
      return;
    }

    publishRspackSsrGraph({
      buildAssetsDir,
      clientOutDir,
      entryFile,
      manifestFileName:
        options.config?.manifest === false
          ? undefined
          : resolveManifestFileName(options),
      serverOutDir,
    });
  });
}

function publishRspackSsrGraph(options: {
  buildAssetsDir: string;
  clientOutDir: string;
  entryFile: string;
  manifestFileName?: string;
  serverOutDir: string;
}) {
  const serverEntry = resolve(options.serverOutDir, options.entryFile);
  if (
    !isWithinDirectory(serverEntry, options.serverOutDir) ||
    !existsSync(serverEntry)
  ) {
    throw new Error(
      `[module-federation] Nuxt Rspack SSR remote entry ${options.entryFile} was not generated.`,
    );
  }

  const serverGraph = collectServerGraph(
    options.serverOutDir,
    options.entryFile,
  );
  const publishedBundle: Record<string, PublishedChunk> = {};
  const publishedFiles = new Set<string>();
  const publishedChunks = new Set<string>();

  for (const [fileName, source] of serverGraph) {
    const publishedFileName = posix.join(
      options.buildAssetsDir,
      RSPACK_SSR_GRAPH_DIR,
      fileName,
    );
    const destination = resolve(options.clientOutDir, publishedFileName);
    if (!isWithinDirectory(destination, options.clientOutDir)) {
      throw new Error(
        `[module-federation] Cannot publish Nuxt Rspack SSR output file ${fileName}.`,
      );
    }

    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, source);
    publishedBundle[publishedFileName] = { code: source, type: "chunk" };
    publishedFiles.add(publishedFileName);
    publishedChunks.add(publishedFileName);
  }

  const graphEntry = posix.join(
    options.buildAssetsDir,
    RSPACK_SSR_GRAPH_DIR,
    options.entryFile,
  );
  const wrapperSpecifier = toRelativeSpecifier(
    posix.dirname(options.entryFile),
    graphEntry,
  );
  const wrapperSource = `export * from ${JSON.stringify(wrapperSpecifier)};\n`;
  const wrapperPath = resolve(options.clientOutDir, options.entryFile);
  if (!isWithinDirectory(wrapperPath, options.clientOutDir)) {
    throw new Error(
      `[module-federation] Cannot publish Nuxt Rspack SSR entry ${options.entryFile}.`,
    );
  }
  mkdirSync(dirname(wrapperPath), { recursive: true });
  writeFileSync(wrapperPath, wrapperSource);
  publishedBundle[options.entryFile] = {
    code: wrapperSource,
    type: "chunk",
  };
  publishedFiles.add(options.entryFile);
  publishedChunks.add(options.entryFile);

  assertPortableSsrOutputGraph(publishedBundle, publishedChunks);
  const fingerprint = createSsrOutputFingerprint(
    publishedBundle,
    publishedFiles,
    publishedChunks,
  );
  if (options.manifestFileName) {
    recordSsrFingerprint(
      options.clientOutDir,
      options.buildAssetsDir,
      options.manifestFileName,
      fingerprint,
    );
  }
}

function collectServerGraph(serverOutDir: string, entryFile: string) {
  const graph = new Map<string, string>();
  const pending = [entryFile];

  while (pending.length > 0) {
    const fileName = pending.pop()!;
    if (graph.has(fileName)) continue;

    const path = resolve(serverOutDir, fileName);
    if (!isWithinDirectory(path, serverOutDir) || !existsSync(path)) {
      throw new Error(
        `[module-federation] Nuxt Rspack SSR output imports missing file ${fileName}.`,
      );
    }

    const source = sanitizeRspackServerSource(
      readFileSync(path, "utf8"),
      fileName,
      (dependency) => existsSync(resolve(serverOutDir, dependency)),
    );
    graph.set(fileName, source);
    for (const specifier of findModuleSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue;
      const dependency = posix.normalize(
        posix.join(posix.dirname(fileName), specifier.replace(/[?#].*$/, "")),
      );
      if (
        !graph.has(dependency) &&
        existsSync(resolve(serverOutDir, dependency))
      ) {
        pending.push(dependency);
      }
    }
  }

  const bundle = Object.fromEntries(
    [...graph].map(([fileName, code]) => [
      fileName,
      { code, type: "chunk" as const },
    ]),
  );
  assertPortableSsrOutputGraph(bundle, new Set(graph.keys()));
  return graph;
}

export function sanitizeRspackServerSource(
  source: string,
  fileName: string,
  hasFile: (fileName: string) => boolean,
) {
  return sanitizeJavaScriptComments(source).replace(
    STRING_LITERAL_RE,
    (literal) => {
      const hasMissingRelativeImport = findModuleSpecifiers(literal).some(
        (specifier) => {
          if (!specifier.startsWith(".")) return false;
          const dependency = posix.normalize(
            posix.join(
              posix.dirname(fileName),
              specifier.replace(/[?#].*$/, ""),
            ),
          );
          return !hasFile(dependency);
        },
      );
      if (!hasMissingRelativeImport) return literal;

      // Preserve the runtime string while hiding import-like prose from MF
      // Vite's source scanner (for example parser error messages).
      return literal
        .replace(/\bimport\b/g, "impor\\x74")
        .replace(/\bfrom\b/g, "fro\\x6d");
    },
  );
}

function recordSsrFingerprint(
  clientOutDir: string,
  buildAssetsDir: string,
  manifestFileName: string,
  fingerprint: string,
) {
  const manifestPath = resolve(clientOutDir, buildAssetsDir, manifestFileName);
  if (
    !isWithinDirectory(manifestPath, clientOutDir) ||
    !existsSync(manifestPath)
  ) {
    throw new Error(
      `[module-federation] Cannot record the Nuxt Rspack SSR output fingerprint in ${manifestFileName}.`,
    );
  }

  writeSsrOutputFingerprint(manifestPath, fingerprint);
  const statsPath = resolve(
    clientOutDir,
    buildAssetsDir,
    getStatsFileName(manifestFileName),
  );
  if (isWithinDirectory(statsPath, clientOutDir) && existsSync(statsPath)) {
    writeSsrOutputFingerprint(statsPath, fingerprint);
  }
}

function toRelativeSpecifier(fromDir: string, toPath: string) {
  const specifier = posix.relative(fromDir, toPath);
  return specifier.startsWith(".") ? specifier : `./${specifier}`;
}

function normalizeBuildAssetsDir(path: string) {
  return path.replace(/^\/+|\/+$/g, "");
}

function isWithinDirectory(path: string, directory: string) {
  const relativePath = relative(resolve(directory), resolve(path));
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}
