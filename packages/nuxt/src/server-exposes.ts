import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";
import {
  getStatsFileName,
  resolveSsrRemoteEntryFileName,
} from "./federation-paths";
import { isJsonObject } from "./json";
import type { ModuleOptions } from "./options";
import {
  isFederationPlugin,
  MF_SSR_ENTRY_PRE_PLUGIN,
  patchServerExposeResolver,
} from "./server-expose-resolver";
import {
  createSsrOutputFingerprint,
  stripSourceMapReference,
} from "./server-output-fingerprint";
import {
  assertPortableSsrOutputGraph,
  findModuleSpecifiers,
} from "./server-output-portability";

const MF_SSR_ENTRY_PLUGIN = "mf:ssr-remote-entry";
const MF_INTERNAL_NAME_PREFIX = "__mfe_internal__";
const MF_SSR_ENTRY_ID = "virtual:mf-REMOTE_ENTRY_SSR_ID";

type FederationConfig = NonNullable<ModuleOptions["config"]>;

interface ServerExposeConfig {
  externalPackages: string[];
  exposes: FederationConfig["exposes"];
  filename: string;
  manifestFileName?: string;
  name: string;
}

interface OutputAsset {
  fileName: string;
  source: string | Uint8Array;
  type: "asset";
}

interface OutputChunk {
  code: string;
  dynamicImports: string[];
  fileName: string;
  implicitlyLoadedBefore?: string[];
  imports: string[];
  referencedFiles?: string[];
  type: "chunk";
  viteMetadata?: {
    importedAssets?: Set<string>;
    importedCss?: Set<string>;
  };
}

type OutputBundle = Record<string, OutputAsset | OutputChunk>;

interface BuildContext {
  emitFile(file: {
    fileName: string;
    id: string;
    name: string;
    preserveSignature: "strict";
    type: "chunk";
  }): string;
  environment?: {
    config?: {
      build?: { ssr?: unknown };
      consumer?: string;
    };
    name?: string;
  };
}

/**
 * Replace MF Vite's client-compiled Nuxt SSR entry with a server-built entry.
 * The upstream resolve/load hooks remain active for development and for the
 * existing SSR virtual modules used by the publisher below.
 */
export function publishServerExposes<Plugin>(
  plugins: Plugin[],
  config: ServerExposeConfig,
  rootDir: string,
  clientOutDir: string,
) {
  // MF Vite is intentionally a no-op under Vitest/Jest/NODE_ENV=test.
  if (plugins.length === 0) return plugins;

  const entryId = resolveMfSsrEntryId(config);
  let patchedSsrGraphResolver = false;
  let replacedSsrBuildHooks = false;
  const patchedPlugins = plugins.map((plugin) => {
    if (!isFederationPlugin(plugin)) {
      return plugin;
    }

    if (plugin.name === MF_SSR_ENTRY_PRE_PLUGIN) {
      patchedSsrGraphResolver = true;
      return patchServerExposeResolver(
        plugin,
        entryId,
        config.externalPackages,
      );
    }

    if (plugin.name === MF_SSR_ENTRY_PLUGIN) {
      replacedSsrBuildHooks = true;
      return {
        ...plugin,
        buildStart: undefined,
        generateBundle: undefined,
        writeBundle: undefined,
      };
    }

    return plugin;
  });

  if (!patchedSsrGraphResolver) {
    throw new Error(
      `[module-federation] ${MF_SSR_ENTRY_PRE_PLUGIN} is missing; cannot bundle Nuxt server exposes.`,
    );
  }
  if (!replacedSsrBuildHooks) {
    throw new Error(
      `[module-federation] ${MF_SSR_ENTRY_PLUGIN} is missing; cannot publish Nuxt server exposes.`,
    );
  }

  return [
    ...patchedPlugins,
    createServerExposePublisher(config, rootDir, clientOutDir),
  ];
}

function createServerExposePublisher(
  config: ServerExposeConfig,
  rootDir: string,
  clientOutDir: string,
) {
  const entryFile = resolveSsrRemoteEntryFileName(config.filename);
  const entryId = resolveMfSsrEntryId(config);
  const hasExposes =
    isJsonObject(config.exposes) && Object.keys(config.exposes).length > 0;
  let outputFiles = new Set<string>();
  let outputChunks = new Set<string>();
  let outputFingerprint: string | undefined;

  return {
    name: "module-federation:nuxt:ssr-exposes-publisher",
    apply: "build" as const,
    enforce: "post" as const,
    buildStart(this: BuildContext) {
      if (!hasExposes || !isServerBuild(this)) return;

      this.emitFile({
        type: "chunk",
        id: entryId,
        name: "ssrRemoteEntry",
        fileName: entryFile,
        preserveSignature: "strict",
      });
    },
    generateBundle(
      this: BuildContext,
      _options: unknown,
      bundle: OutputBundle,
    ) {
      if (!hasExposes || !isServerBuild(this)) return;
      if (!bundle[entryFile]) {
        throw new Error(
          `[module-federation] Nuxt SSR remote entry ${entryFile} was not generated.`,
        );
      }

      const outputGraph = collectOutputFiles(bundle, entryFile);
      assertPortableSsrOutputGraph(bundle, outputGraph.chunks);
      outputFiles = outputGraph.files;
      outputChunks = outputGraph.chunks;
      outputFingerprint = createSsrOutputFingerprint(
        bundle,
        outputFiles,
        outputChunks,
      );
    },
    writeBundle(this: BuildContext, outputOptions: { dir?: string }) {
      if (!hasExposes || !isServerBuild(this)) return;
      if (!outputOptions.dir) {
        throw new Error(
          "[module-federation] Cannot publish Nuxt SSR exposes without a Vite output directory.",
        );
      }

      publishOutputFiles({
        clientOutDir: resolve(clientOutDir),
        entryFile,
        outputChunks,
        outputFiles,
        serverOutDir: resolve(rootDir, outputOptions.dir),
      });
      if (config.manifestFileName && outputFingerprint) {
        publishSsrOutputFingerprint(
          resolve(clientOutDir),
          config.manifestFileName,
          outputFingerprint,
        );
      }
    },
  };
}

function resolveMfSsrEntryId(config: ServerExposeConfig) {
  const internalName = config.name.startsWith(MF_INTERNAL_NAME_PREFIX)
    ? config.name
    : `${MF_INTERNAL_NAME_PREFIX}${config.name}`;
  const token = `${internalName}__${config.filename}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );

  return `${MF_SSR_ENTRY_ID}:${token}`;
}

function isServerBuild(context: BuildContext) {
  const environment = context.environment;

  return (
    environment?.name === "ssr" ||
    environment?.name === "server" ||
    environment?.config?.consumer === "server" ||
    Boolean(environment?.config?.build?.ssr)
  );
}

function collectOutputFiles(bundle: OutputBundle, entryFile: string) {
  const collected = new Set<string>();
  const chunks = new Set<string>();
  const pending = [entryFile];

  while (pending.length > 0) {
    const fileName = pending.pop()!;
    if (collected.has(fileName)) continue;

    const output = bundle[fileName];
    if (!output) continue;
    collected.add(fileName);

    const dependencies = new Set<string>();
    if (output.type === "chunk") {
      chunks.add(fileName);
      for (const dependency of [
        ...output.imports,
        ...output.dynamicImports,
        ...(output.implicitlyLoadedBefore || []),
        ...(output.referencedFiles || []),
        ...(output.viteMetadata?.importedAssets || []),
        ...(output.viteMetadata?.importedCss || []),
      ]) {
        dependencies.add(dependency);
      }
    }

    const source =
      output.type === "chunk"
        ? output.code
        : typeof output.source === "string"
          ? output.source
          : "";
    const outputDir = posix.dirname(fileName);
    for (const specifier of findModuleSpecifiers(source)) {
      if (specifier.startsWith(".")) {
        dependencies.add(posix.normalize(posix.join(outputDir, specifier)));
      }
    }

    for (const dependency of dependencies) {
      if (bundle[dependency] && !collected.has(dependency)) {
        pending.push(dependency);
      }
    }
  }

  return { chunks, files: collected };
}

function publishOutputFiles(options: {
  clientOutDir: string;
  entryFile: string;
  outputChunks: Set<string>;
  outputFiles: Set<string>;
  serverOutDir: string;
}) {
  const files = [...options.outputFiles].sort(
    (left, right) =>
      Number(left === options.entryFile) - Number(right === options.entryFile),
  );

  for (const fileName of files) {
    const source = resolve(options.serverOutDir, fileName);
    const destination = resolve(options.clientOutDir, fileName);
    if (
      !isWithinDirectory(source, options.serverOutDir) ||
      !isWithinDirectory(destination, options.clientOutDir) ||
      !existsSync(source)
    ) {
      throw new Error(
        `[module-federation] Cannot publish Nuxt SSR output file ${fileName}.`,
      );
    }

    const publishedSource = options.outputChunks.has(fileName)
      ? Buffer.from(stripSourceMapReference(readFileSync(source, "utf8")))
      : readFileSync(source);

    // Content-hashed browser chunks are authoritative if an identical path is
    // already present. A custom non-hashed collision cannot safely serve both
    // targets, so fail instead of silently publishing a mixed module graph.
    if (fileName !== options.entryFile && existsSync(destination)) {
      if (!publishedSource.equals(readFileSync(destination))) {
        throw new Error(
          `[module-federation] Nuxt client and server builds emitted different files at ${fileName}.`,
        );
      }
      continue;
    }

    mkdirSync(dirname(destination), { recursive: true });
    if (options.outputChunks.has(fileName)) {
      writeFileSync(destination, publishedSource);
    } else {
      copyFileSync(source, destination);
    }
  }
}

function publishSsrOutputFingerprint(
  clientOutDir: string,
  manifestFileName: string,
  fingerprint: string,
) {
  const manifestPath = resolve(clientOutDir, manifestFileName);
  if (
    !isWithinDirectory(manifestPath, clientOutDir) ||
    !existsSync(manifestPath)
  ) {
    throw new Error(
      `[module-federation] Cannot record the Nuxt SSR output fingerprint in ${manifestFileName}.`,
    );
  }

  writeSsrOutputFingerprint(manifestPath, fingerprint);
  const statsPath = resolve(clientOutDir, getStatsFileName(manifestFileName));
  if (isWithinDirectory(statsPath, clientOutDir) && existsSync(statsPath)) {
    writeSsrOutputFingerprint(statsPath, fingerprint);
  }
}

function writeSsrOutputFingerprint(path: string, fingerprint: string) {
  const document: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isJsonObject(document)) {
    throw new Error(
      `[module-federation] Cannot record the Nuxt SSR output fingerprint in ${path}.`,
    );
  }

  const metaData = isJsonObject(document.metaData) ? document.metaData : {};
  const custom = isJsonObject(metaData.custom) ? metaData.custom : {};
  metaData.custom = { ...custom, nuxtSsrBuildHash: fingerprint };
  document.metaData = metaData;
  writeFileSync(path, JSON.stringify(document));
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
