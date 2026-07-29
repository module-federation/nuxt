import assert from "node:assert/strict";
import http from "node:http";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./helpers/release.mjs";

test("SSR loader retries a failed stable manifest redirect probe", async (context) => {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/current/mf-manifest.json") {
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
  await new Promise((resolveServer) =>
    server.listen(0, "127.0.0.1", resolveServer),
  );
  context.after(
    () =>
      new Promise((resolveServer, reject) =>
        server.close((error) => (error ? reject(error) : resolveServer())),
      ),
  );

  const { port } = server.address();
  const stableManifest = `http://127.0.0.1:${port}/current/mf-manifest.json`;
  const originalFetch = globalThis.fetch;
  let stableHeadRequests = 0;
  globalThis.fetch = async (input, init = {}) => {
    if (String(input) === stableManifest && init.method === "HEAD") {
      stableHeadRequests += 1;
      if (stableHeadRequests === 1) {
        throw new TypeError("simulated transient network failure");
      }
    }
    return originalFetch(input, init);
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const builtLoader = resolve(
    repoRoot,
    "packages/nuxt/dist/ssr-entry-loader.mjs",
  );
  const { default: portableSsrEntryLoader } = await import(
    pathToFileURL(builtLoader).href
  );
  const hostName = "redirect-recovery-host";
  const plugin = portableSsrEntryLoader({ hostName });
  const host = { options: { name: hostName, remotes: [] } };
  const remoteInfo = {
    entry: stableManifest,
    name: "remote",
    version: stableManifest,
  };

  await assert.rejects(plugin.loadEntry({ origin: host, remoteInfo }));
  const container = await plugin.loadEntry({ origin: host, remoteInfo });

  assert.equal(typeof container?.get, "function");
  assert.equal(stableHeadRequests, 2);
});
