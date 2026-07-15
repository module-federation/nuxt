import { existsSync } from "node:fs";
import { isBuiltin } from "node:module";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

export const MF_SSR_ENTRY_PRE_PLUGIN = "mf:ssr-remote-entry:pre";
const MF_SSR_BUNDLED_QUERY = "__mf_ssr_expose";

export interface FederationPlugin {
  buildStart?: unknown;
  configResolved?: FederationConfigResolvedHook;
  generateBundle?: unknown;
  name?: string;
  resolveId?: FederationResolveIdHook | OrderedFederationResolveIdHook;
  writeBundle?: unknown;
}

interface FederationResolvedConfig {
  createResolver(): FederationResolver;
  environments?: Record<string, FederationResolvedEnvironment | undefined>;
}

interface FederationResolvedEnvironment {
  build?: { ssr?: unknown };
  consumer?: string;
  resolve?: { external?: string[] | true };
}

interface FederationResolveResult {
  external?: boolean;
  id: string;
}

interface FederationResolveContext {
  resolve?(
    id: string,
    importer?: string,
    options?: { skipSelf?: boolean },
  ): Promise<FederationResolveResult | null>;
}

type FederationResolver = (
  id: string,
  importer?: string,
  aliasOnly?: boolean,
  ssr?: boolean,
) => Promise<string | undefined>;

type FederationConfigResolvedHook = (
  this: unknown,
  config: FederationResolvedConfig,
) => unknown;

type FederationResolveIdHook = (
  this: unknown,
  id: string,
  importer?: string,
  options?: unknown,
) => unknown;

interface OrderedFederationResolveIdHook {
  handler: FederationResolveIdHook;
  order?: "pre" | "post";
}

export function isFederationPlugin(value: unknown): value is FederationPlugin {
  return Boolean(value && typeof value === "object");
}

/**
 * Nuxt externalizes dependencies in its SSR build. Override that behavior only
 * for modules reachable from the federation server entry so remote-only
 * dependencies travel with the exposed graph without bloating the Nuxt server.
 */
export function patchServerExposeResolver(
  plugin: FederationPlugin,
  entryId: string,
  configuredExternals: string[],
) {
  const serverGraph = new Set([normalizeServerGraphId(entryId)]);
  const externalPackages = new Set(configuredExternals);
  const originalConfigResolved = plugin.configResolved;
  const originalResolveId = getResolveIdHandler(plugin.resolveId);
  const bundledSources = new Map<string, string>();
  let resolveModule: FederationResolver | undefined;

  return {
    ...plugin,
    async configResolved(this: unknown, config: FederationResolvedConfig) {
      await originalConfigResolved?.call(this, config);
      resolveModule = config.createResolver();
      collectConfiguredServerExternals(config, externalPackages);
    },
    resolveId: {
      order: "pre",
      async handler(
        this: unknown,
        id: string,
        importer?: string,
        options?: unknown,
      ) {
        const upstreamResult = await originalResolveId?.call(
          this,
          id,
          importer,
          options,
        );
        if (!importer || !isServerGraphImporter(importer, serverGraph)) {
          return upstreamResult;
        }

        const upstreamId = readResolvedId(upstreamResult);
        if (upstreamId) {
          serverGraph.add(normalizeServerGraphId(upstreamId));
        }
        const externalFileId = readExternalFileId(upstreamResult);
        if (
          (upstreamResult != null && !externalFileId) ||
          !shouldResolveServerDependency(id, externalPackages)
        ) {
          return upstreamResult;
        }

        const sourceImporter = bundledSources.get(importer) || importer;
        const contextResolution = externalFileId
          ? undefined
          : await (this as FederationResolveContext).resolve?.(
              id,
              sourceImporter,
              { skipSelf: true },
            );
        const fallbackId =
          !contextResolution && !externalFileId && resolveModule
            ? await resolveModule(id, sourceImporter, false, true)
            : undefined;
        const resolvedId =
          readResolvedId(contextResolution) || externalFileId || fallbackId;
        if (!resolvedId) return upstreamResult;

        const shouldForceBundle = Boolean(
          externalFileId ||
          fallbackId ||
          (upstreamResult == null &&
            (isFederationVirtualModuleId(resolvedId) ||
              isExistingFileModuleId(resolvedId))),
        );
        if (shouldForceBundle) {
          const bundledId = withServerExposeQuery(resolvedId);
          bundledSources.set(bundledId, resolvedId);
          serverGraph.add(normalizeServerGraphId(bundledId));
          return { id: bundledId, external: false };
        }

        serverGraph.add(normalizeServerGraphId(resolvedId));
        return contextResolution || upstreamResult;
      },
    },
  } satisfies FederationPlugin;
}

function normalizeServerGraphId(id: string) {
  let normalized = id;
  if (normalized.startsWith("/@id/")) {
    normalized = normalized.slice(5).replace(/^__x00__/, "\0");
  }
  normalized = normalized.replace(/^\0+/, "");

  const queryIndex = normalized.indexOf("?");
  const hashIndex = normalized.indexOf("#", 1);
  const endIndex =
    queryIndex < 0
      ? hashIndex
      : hashIndex < 0
        ? queryIndex
        : Math.min(queryIndex, hashIndex);
  if (endIndex >= 0) normalized = normalized.slice(0, endIndex);

  if (normalized.startsWith("file:")) {
    try {
      normalized = fileURLToPath(normalized);
    } catch {
      // Keep malformed file URLs unchanged so they cannot match tracked IDs.
    }
  }
  if (normalized.startsWith("/@fs/")) normalized = normalized.slice(4);
  return normalized;
}

function isServerGraphImporter(importer: string, serverGraph: Set<string>) {
  return serverGraph.has(normalizeServerGraphId(importer));
}

function isFederationVirtualModuleId(id: string) {
  return normalizeServerGraphId(id).startsWith("virtual:mf:");
}

function isExistingFileModuleId(id: string) {
  const normalized = normalizeServerGraphId(id);
  return isFileModuleId(normalized) && existsSync(normalized);
}

function getResolveIdHandler(
  hook: FederationPlugin["resolveId"],
): FederationResolveIdHook | undefined {
  if (typeof hook === "function") return hook;
  return hook?.handler;
}

function collectConfiguredServerExternals(
  config: FederationResolvedConfig,
  externalPackages: Set<string>,
) {
  for (const [name, environment] of Object.entries(config.environments || {})) {
    if (
      !environment ||
      (name !== "ssr" &&
        name !== "server" &&
        environment.consumer !== "server" &&
        !environment.build?.ssr)
    ) {
      continue;
    }

    const external = environment.resolve?.external;
    if (Array.isArray(external)) {
      for (const specifier of external) externalPackages.add(specifier);
    }
  }
}

function readResolvedId(result: unknown) {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object" || !("id" in result)) return;

  return typeof (result as FederationResolveResult).id === "string"
    ? (result as FederationResolveResult).id
    : undefined;
}

function readExternalFileId(result: unknown) {
  if (
    !result ||
    typeof result !== "object" ||
    !("id" in result) ||
    !("external" in result)
  ) {
    return;
  }

  const resolution = result as FederationResolveResult;
  return resolution.external === true && isFileModuleId(resolution.id)
    ? resolution.id
    : undefined;
}

function isFileModuleId(id: string) {
  return Boolean(
    id &&
    (isAbsolute(id) ||
      /^[a-zA-Z]:[\\/]/.test(id) ||
      id.startsWith("file:") ||
      id.startsWith("/@fs/")),
  );
}

function shouldResolveServerDependency(
  id: string,
  externalPackages: Set<string>,
) {
  if (!id || isBuiltin(id)) {
    return false;
  }
  if (isFederationVirtualModuleId(id)) return true;
  if (id.startsWith("\0") || id.startsWith("virtual:")) return false;

  return (
    !isBareSpecifier(id) ||
    ![...externalPackages].some((packageName) =>
      matchesPackageSpecifier(id, packageName),
    )
  );
}

function isBareSpecifier(id: string) {
  return Boolean(
    id &&
    !id.startsWith(".") &&
    !id.startsWith("\0") &&
    !id.startsWith("/") &&
    !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(id) &&
    !isAbsolute(id),
  );
}

function matchesPackageSpecifier(id: string, packageName: string) {
  const normalized = packageName.replace(/\/+$/, "");
  return Boolean(
    normalized && (id === normalized || id.startsWith(`${normalized}/`)),
  );
}

function withServerExposeQuery(id: string) {
  if (id.includes(MF_SSR_BUNDLED_QUERY)) return id;

  const hashIndex = id.indexOf("#");
  const pathAndQuery = hashIndex < 0 ? id : id.slice(0, hashIndex);
  const hash = hashIndex < 0 ? "" : id.slice(hashIndex);
  const separator = pathAndQuery.includes("?") ? "&" : "?";

  return `${pathAndQuery}${separator}${MF_SSR_BUNDLED_QUERY}${hash}`;
}
