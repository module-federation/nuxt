import { addDevServerHandler, extendRouteRules, type useNuxt } from "@nuxt/kit";
import { resolveFederationAssetFileNames } from "./federation-paths";
import type { ModuleOptions } from "./options";
import { resolveBuildAssetUrl } from "./route-paths";

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
  const createHandler =
    (matchedAssetPath?: string) => (event: NodeRequestEvent) => {
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
          matchedAssetPath,
        ),
      );
      event.node.res.end();
    };

  if (routeBase === "/") {
    for (const route of assetFiles.map(normalizePath)) {
      addDevServerHandler({ route, handler: createHandler(route) });
    }
    return;
  }

  const handler = createHandler();
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

  // With a custom base, the browser entry is also copied to the public root for
  // legacy direct-entry consumers, so it needs CORS headers too.
  return [`${routeBase}/**`, ...assetFiles.map(normalizePath)];
}

function normalizePath(path: string) {
  return `/${path}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}
