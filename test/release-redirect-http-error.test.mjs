import assert from "node:assert/strict";
import http from "node:http";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./helpers/release.mjs";

test("SSR loader retries a redirect probe after an HTTP error response", async (context) => {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/current/mf-manifest.json") {
      const malformed = url.searchParams.get("mode") === "malformed";
      if (request.method === "HEAD") {
        if (malformed) {
          server.malformedHeadRequests += 1;
          if (server.malformedHeadRequests === 1) {
            response.writeHead(302);
            response.end();
            return;
          }
        } else {
          server.headRequests += 1;
        }
        if (!malformed && server.headRequests === 1) {
          response.writeHead(503);
          response.end();
          return;
        }
      }
      if (malformed && request.method !== "HEAD") {
        response.writeHead(302);
        response.end();
        return;
      }
      response.writeHead(302, { location: "/releases/v1/mf-manifest.json" });
      response.end();
      return;
    }
    if (url.pathname === "/releases/v1/mf-manifest.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          metaData: {
            ssrRemoteEntry: {
              name: "remoteEntry.ssr.js",
              path: "",
              type: "module",
            },
          },
        }),
      );
      return;
    }
    if (url.pathname === "/releases/v1/remoteEntry.ssr.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(
        "export const init = () => {}; export const get = () => () => ({});",
      );
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.headRequests = 0;
  server.malformedHeadRequests = 0;
  await new Promise((resolveServer) =>
    server.listen(0, "127.0.0.1", resolveServer),
  );
  context.after(
    () =>
      new Promise((resolveServer, reject) =>
        server.close((error) => (error ? reject(error) : resolveServer())),
      ),
  );

  const builtLoader = resolve(
    repoRoot,
    "packages/nuxt/dist/ssr-entry-loader.mjs",
  );
  const { default: portableSsrEntryLoader } = await import(
    pathToFileURL(builtLoader).href
  );
  const hostName = "http-error-recovery-host";
  const plugin = portableSsrEntryLoader({ hostName });
  const host = { options: { name: hostName, remotes: [] } };
  const stableManifest = `http://127.0.0.1:${server.address().port}/current/mf-manifest.json`;
  const remoteInfo = {
    entry: stableManifest,
    name: "remote",
    version: stableManifest,
  };

  await assert.rejects(plugin.loadEntry({ origin: host, remoteInfo }));
  const container = await plugin.loadEntry({ origin: host, remoteInfo });

  assert.equal(typeof container?.get, "function");
  assert.equal(server.headRequests, 2);

  const malformedManifest = `${stableManifest}?mode=malformed`;
  const malformedRemoteInfo = {
    entry: malformedManifest,
    name: "malformed-remote",
    version: malformedManifest,
  };
  await assert.rejects(
    plugin.loadEntry({ origin: host, remoteInfo: malformedRemoteInfo }),
  );
  const recoveredMalformed = await plugin.loadEntry({
    origin: host,
    remoteInfo: malformedRemoteInfo,
  });

  assert.equal(typeof recoveredMalformed?.get, "function");
  assert.equal(server.malformedHeadRequests, 2);
});
