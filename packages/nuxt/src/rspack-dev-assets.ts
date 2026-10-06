import type { Nuxt } from "@nuxt/schema";
import type { IncomingMessage, ServerResponse } from "node:http";
import { posix } from "node:path";
import { resolveFederationAssetFileNames } from "./federation-paths";
import { normalizeBase, type ModuleOptions } from "./options";

interface DevEvent {
  node?: { req: IncomingMessage; res: ServerResponse };
  runtime?: { node?: { req: IncomingMessage; res: ServerResponse } };
}

type DevHandler = (event: DevEvent) => unknown;

/** Serve emitted federation assets before Nuxt's same-origin dev guard. */
export function registerRspackDevAssets(nuxt: Nuxt, options: ModuleOptions) {
  if (!nuxt.options.dev) return;

  const assetsPrefix = normalizeBase(
    posix.join(nuxt.options.app.baseURL, nuxt.options.app.buildAssetsDir),
  );
  const publicBase = normalizeBase(options.base);
  const federationFiles = resolveFederationAssetFileNames(options);
  let clientAssets = new Map<string, string | Uint8Array>();

  nuxt.hook("rspack:compile", ({ name, compiler }) => {
    if (name !== "client") return;
    compiler.hooks.thisCompilation.tap(
      "NuxtFederationDevAssets",
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: "NuxtFederationDevAssets",
            stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
          },
          () => {
            clientAssets = new Map(
              compilation
                .getAssets()
                .map(({ name, source }) => [
                  posix.join(assetsPrefix, name),
                  source.source(),
                ]),
            );
          },
        );
      },
    );
  });

  // Nitro registers its setter after modules finish. A beforeEach hook wraps
  // the builder's handler before that setter receives it, regardless of order.
  const removeHook = nuxt.hooks.beforeEach((event) => {
    if ((event.name as string) !== "server:devHandler") return;
    const args = event.args as unknown[];
    const handler = args[0];
    if (typeof handler !== "function") return;
    args[0] = (request: DevEvent) => {
      const node = request.runtime?.node || request.node;
      if (!node) return (handler as DevHandler)(request);
      const method = node.req.method || "GET";
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        return (handler as DevHandler)(request);
      }
      let pathname: string;
      let query: string;
      try {
        const requestUrl = new URL(node.req.url || "/", "http://nuxt.local");
        pathname = decodeURIComponent(requestUrl.pathname);
        query = requestUrl.search;
      } catch {
        return (handler as DevHandler)(request);
      }

      const federationFile = federationFiles.find(
        (file) => pathname === posix.join(publicBase, file),
      );
      if (federationFile && !pathname.startsWith(`${assetsPrefix}/`)) {
        node.res.statusCode = method === "OPTIONS" ? 204 : 307;
        node.res.setHeader("Access-Control-Allow-Origin", "*");
        node.res.setHeader(
          "Location",
          `${posix.join(assetsPrefix, federationFile)}${query}`,
        );
        node.res.end();
        return Symbol.for("h3.handled");
      }

      const source = clientAssets.get(pathname);
      if (source === undefined) return (handler as DevHandler)(request);

      node.res.statusCode = method === "OPTIONS" ? 204 : 200;
      node.res.setHeader("Access-Control-Allow-Origin", "*");
      node.res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      node.res.setHeader("Cache-Control", "no-store");
      node.res.setHeader("Content-Type", contentType(pathname));
      node.res.end(method === "GET" ? source : undefined);
      return Symbol.for("h3.handled");
    };
  });
  nuxt.hook("close", removeHook);
}

function contentType(path: string) {
  switch (posix.extname(path)) {
    case ".js":
    case ".mjs":
    case ".cjs":
      return "text/javascript; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
}
