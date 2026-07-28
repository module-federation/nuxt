import { addDevServerHandler, extendRouteRules, type useNuxt } from "@nuxt/kit";
import { resolveFederationAssetFileNames } from "./federation-paths";
import type { ModuleOptions } from "./options";

type Nuxt = ReturnType<typeof useNuxt>;
interface NodeRequestEvent {
  node: {
    req: {
      method?: string;
      url?: string;
    };
    res: {
      statusCode: number;
      setHeader(name: string, value: string): void;
      end(): void;
    };
  };
}

export function registerRemoteEntryRoutes(
  nuxt: Nuxt,
  publicBase: string,
  options: ModuleOptions,
) {
  const assetFiles = resolveFederationAssetFileNames(options);

  for (const route of getFederationAssetRoutes(publicBase, assetFiles)) {
    extendRouteRules(route, {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  extendRouteRules(`${normalizePath(nuxt.options.app.buildAssetsDir)}/**`, {
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });

  if (nuxt.options.dev) {
    registerRemoteEntryDevRedirect(nuxt, publicBase, assetFiles);
  }
}

function registerRemoteEntryDevRedirect(
  nuxt: Nuxt,
  publicBase: string,
  assetFiles: string[],
) {
  const buildAssetsDir = normalizePath(nuxt.options.app.buildAssetsDir);
  const routeBase = normalizePath(publicBase);
  const handler = (event: NodeRequestEvent) => {
    event.node.res.setHeader("Access-Control-Allow-Origin", "*");

    if (event.node.req.method === "OPTIONS") {
      event.node.res.statusCode = 204;
      event.node.res.end();
      return;
    }

    event.node.res.statusCode = 307;
    event.node.res.setHeader(
      "Location",
      resolveBuildAssetUrl(
        routeBase,
        buildAssetsDir,
        event.node.req.url || "/",
      ),
    );
    event.node.res.end();
  };

  if (routeBase === "/") {
    for (const route of assetFiles.map(normalizePath)) {
      addDevServerHandler({ route, handler });
    }
    return;
  }

  for (const route of [routeBase, `${routeBase}/**`]) {
    addDevServerHandler({
      route,
      handler,
    });
  }
}

function getFederationAssetRoutes(publicBase: string, assetFiles: string[]) {
  const routeBase = normalizePath(publicBase);
  if (routeBase === "/") {
    return assetFiles.map(normalizePath);
  }

  // The browser entry is also copied to the public root for legacy direct-entry
  // consumers (see copyOriginalRemoteEntryAsset), so it needs CORS headers too.
  return [`${routeBase}/**`, ...assetFiles.map(normalizePath)];
}

function normalizePath(path: string) {
  return `/${path}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function resolveBuildAssetUrl(
  publicBase: string,
  buildAssetsDir: string,
  requestUrl: string,
) {
  const [pathname = "/", query] = requestUrl.split("?");
  const assetPath = pathname.startsWith(publicBase)
    ? pathname.slice(publicBase.length)
    : pathname;
  const normalizedAssetPath = assetPath.replace(/^\/+/, "");
  const resolvedPath = `${buildAssetsDir}/${normalizedAssetPath}`;

  return query ? `${resolvedPath}?${query}` : resolvedPath;
}
