import { addDevServerHandler, extendRouteRules, type useNuxt } from "@nuxt/kit";

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

export function registerRemoteEntryRoutes(nuxt: Nuxt, publicBase: string) {
  extendRouteRules(`${publicBase}/**`, {
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });

  if (nuxt.options.dev) {
    registerRemoteEntryDevRedirect(nuxt, publicBase);
  }
}

function registerRemoteEntryDevRedirect(nuxt: Nuxt, publicBase: string) {
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

  const wildcardRoute = routeBase === "/" ? "/**" : `${routeBase}/**`;

  for (const route of [routeBase, wildcardRoute]) {
    addDevServerHandler({
      route,
      handler,
    });
  }
}

function normalizePath(path: string) {
  return `/${path}`.replace(/\/+/g, "/").replace(/\/$/, "");
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
