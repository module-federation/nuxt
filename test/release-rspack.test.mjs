import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import {
  assertPublishedSsrExposeGraph,
  createNuxtFixture,
  nuxtCliPath,
  readRelativeModuleGraph,
  runCommand,
  startNitro,
  startNuxtDev,
  stopProcess,
  waitForResponse,
} from "./helpers/release.mjs";

test(
  "Rspack publishes browser federation assets through Nuxt's public output",
  { timeout: 60_000 },
  async (context) => {
    const fixtureRoot = await createNuxtFixture("remote-rspack", {
      moduleFederation: {
        config: {
          manifest: {
            fileName: "custom-manifest.json",
            filePath: "nested",
          },
          shared: { vue: "vue", "vue-router": "vue-router" },
        },
      },
    });
    const publicRoot = resolve(fixtureRoot, ".output/public");
    const manifestPath = resolve(
      publicRoot,
      "rspack-remote-mf/nested/custom-manifest.json",
    );
    context.after(() => rm(fixtureRoot, { force: true, recursive: true }));

    await runCommand(process.execPath, [
      nuxtCliPath("remote"),
      "build",
      fixtureRoot,
    ]);

    assert.ok(
      existsSync(resolve(publicRoot, "rspack-remote-mf/remoteEntry.js")),
    );
    assert.ok(existsSync(resolve(publicRoot, "remoteEntry.js")));
    assert.ok(
      existsSync(resolve(publicRoot, "rspack-remote-mf/remoteEntry.ssr.js")),
    );

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.metaData.publicPath, "auto");
    assert.equal(manifest.metaData.remoteEntry.name, "remoteEntry.js");
    assert.equal(manifest.metaData.remoteEntry.path, "../");
    assert.deepEqual(manifest.metaData.ssrRemoteEntry, {
      name: "remoteEntry.ssr.js",
      path: "../",
      type: "module",
    });
    assert.match(
      manifest.metaData.custom?.nuxtSsrBuildHash || "",
      /^sha256-[a-f\d]{64}$/,
    );
    assert.deepEqual(manifest.exposes.map((expose) => expose.name).sort(), [
      "Counter",
      "Widget",
      "bridge/export-app",
    ]);

    for (const expose of manifest.exposes) {
      for (const type of ["js", "css"]) {
        for (const asset of expose.assets[type].sync) {
          assert.ok(
            existsSync(resolve(dirname(manifestPath), asset)),
            `Rspack manifest asset is missing: ${asset}`,
          );
        }
      }
    }

    await assertPublishedSsrExposeGraph(
      publicRoot,
      "Rspack production build",
      "remoteEntry.ssr.js",
      "rspack-remote-mf",
      true,
    );
    const serverGraph = await readRelativeModuleGraph(
      publicRoot,
      resolve(publicRoot, "rspack-remote-mf/remoteEntry.ssr.js"),
    );
    assert.match(
      [...serverGraph.values()].join("\n"),
      /shareKey:\s*["']vue-router["'][\s\S]*?eager:\s*true/,
      "string-form router shared config was not made eager for the server build",
    );
  },
);

test(
  "Rspack client-only remote consumption still publishes server exposes",
  { timeout: 60_000 },
  async (context) => {
    const fixtureRoot = await createNuxtFixture("remote-rspack", {
      moduleFederation: {
        ssr: false,
        config: { publicPath: "https://cdn.example.com/rspack-assets/" },
      },
    });
    const publicRoot = resolve(fixtureRoot, ".output/public");
    context.after(() => rm(fixtureRoot, { force: true, recursive: true }));

    await runCommand(process.execPath, [
      nuxtCliPath("remote-rspack"),
      "build",
      fixtureRoot,
    ]);

    assert.ok(
      existsSync(resolve(publicRoot, "rspack-remote-mf/remoteEntry.ssr.js")),
      "ssr: false removed the Rspack remote's server entry",
    );
    const manifest = JSON.parse(
      await readFile(
        resolve(publicRoot, "rspack-remote-mf/mf-manifest.json"),
        "utf8",
      ),
    );
    assert.equal(
      manifest.metaData.publicPath,
      "https://cdn.example.com/rspack-assets/",
    );
    await assertPublishedSsrExposeGraph(
      publicRoot,
      "Rspack client-only remote build",
      "remoteEntry.ssr.js",
      "rspack-remote-mf",
      true,
    );
  },
);

test(
  "Rspack dual-role server expose graph remains portable",
  { timeout: 60_000 },
  async (context) => {
    const fixtureRoot = await createNuxtFixture("remote-rspack", {
      moduleFederation: {
        config: {
          name: "dualRspack",
          remotes: {
            upstream:
              "upstream@http://127.0.0.1:65535/upstream/mf-manifest.json",
          },
        },
      },
    });
    const publicRoot = resolve(fixtureRoot, ".output/public");
    context.after(() => rm(fixtureRoot, { force: true, recursive: true }));

    await runCommand(process.execPath, [
      nuxtCliPath("remote-rspack"),
      "build",
      fixtureRoot,
    ]);

    await assertPublishedSsrExposeGraph(
      publicRoot,
      "Rspack dual-role production build",
      "remoteEntry.ssr.js",
      "rspack-remote-mf",
      true,
    );
  },
);

test(
  "Rspack resolves array-valued expose imports from the Nuxt root",
  { timeout: 60_000 },
  async (context) => {
    const fixtureRoot = await createNuxtFixture("remote-rspack", {
      srcDir: "./app",
      moduleFederation: {
        exposedDir: "./empty-exposes",
        config: {
          exposes: {
            "./Multiple": {
              import: ["./app/First.vue", "./app/Second.vue"],
            },
          },
        },
      },
    });
    context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
    await Promise.all([
      mkdir(resolve(fixtureRoot, "app"), { recursive: true }),
      mkdir(resolve(fixtureRoot, "empty-exposes"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        resolve(fixtureRoot, "app/app.vue"),
        "<template><main>CSS-free fixture</main></template>\n",
      ),
      writeFile(
        resolve(fixtureRoot, "app/First.vue"),
        "<template><div>First expose</div></template>\n",
      ),
      writeFile(
        resolve(fixtureRoot, "app/Second.vue"),
        "<template><div>Second expose</div></template>\n",
      ),
    ]);

    await runCommand(process.execPath, [
      nuxtCliPath("remote-rspack"),
      "build",
      fixtureRoot,
    ]);

    const publicRoot = resolve(fixtureRoot, ".output/public");
    const serverEntry = resolve(
      publicRoot,
      "rspack-remote-assets/ssr/remoteEntry.ssr.js",
    );
    assert.ok(existsSync(serverEntry));
    await assertPublishedSsrExposeGraph(
      publicRoot,
      "Rspack CSS-free array expose build",
      "remoteEntry.ssr.js",
      "rspack-remote-mf",
      true,
    );
  },
);

test(
  "Rspack production renders remote components before hydration",
  { timeout: 30_000 },
  async (context) => {
    const processes = [];
    context.after(async () => {
      await Promise.all(processes.map(stopProcess));
    });

    const remote = startNitro("remote-rspack", 4176);
    processes.push(remote);
    await waitForResponse(
      "http://127.0.0.1:4176/rspack-remote-mf/mf-manifest.json",
      remote,
      ({ status }) => status === 200,
    );

    const host = startNitro("host-rspack", 4175);
    processes.push(host);
    const response = await waitForResponse(
      "http://127.0.0.1:4175/",
      host,
      ({ body, status }) =>
        status === 200 &&
        body.includes("Remote SSR component") &&
        body.includes("Rendered by remote before client hydration."),
    );

    assert.match(response.body, /Remote SSR component/);
    assert.match(response.body, /Rendered by remote before client hydration\./);
  },
);

test(
  "Rspack development renders remote components before hydration",
  { timeout: 90_000 },
  async (context) => {
    const processes = [];
    context.after(async () => {
      await Promise.all(processes.map(stopProcess));
    });

    const remote = startNuxtDev("remote-rspack", 4176);
    processes.push(remote);
    await waitForResponse(
      "http://127.0.0.1:4176/rspack-remote-mf/mf-manifest.json",
      remote,
      ({ status }) => status === 200,
    );

    const crossOriginHeaders = {
      origin: "https://host.example",
      "sec-fetch-site": "cross-site",
    };
    const entry = await fetch(
      "http://127.0.0.1:4176/rspack-remote-mf/remoteEntry.js",
      {
        headers: crossOriginHeaders,
      },
    );
    assert.equal(
      entry.status,
      200,
      "cross-origin development entry is blocked",
    );
    assert.equal(entry.headers.get("access-control-allow-origin"), "*");
    const unknown = await fetch(
      "http://127.0.0.1:4176/rspack-remote-assets/not-emitted.js",
      {
        headers: crossOriginHeaders,
      },
    );
    assert.equal(
      unknown.status,
      403,
      "unknown development assets bypassed Nuxt's origin guard",
    );

    const host = startNuxtDev("host-rspack", 4175);
    processes.push(host);
    const response = await waitForResponse(
      "http://127.0.0.1:4175/",
      host,
      ({ body, status }) =>
        status === 200 &&
        body.includes("Remote SSR component") &&
        body.includes("Rendered by remote before client hydration."),
    );

    assert.match(response.body, /Remote SSR component/);
    assert.match(response.body, /Rendered by remote before client hydration\./);
  },
);

test(
  "Rspack SSR remote loading validates import:false shared host dependencies",
  { timeout: 45_000 },
  async (context) => {
    const fixtureRoot = await createNuxtFixture("host-rspack", {
      moduleFederation: {
        config: {
          shared: {
            "remote-provided-package": { import: false },
          },
        },
      },
    });
    context.after(() => rm(fixtureRoot, { force: true, recursive: true }));

    await assert.rejects(
      runCommand(process.execPath, [
        nuxtCliPath("host-rspack"),
        "build",
        fixtureRoot,
      ]),
      /Shared dependency "remote-provided-package" .*must be installed in the host application for SSR/,
    );
  },
);

test(
  "Rspack SSR remote loading validates import:false shared host versions",
  { timeout: 45_000 },
  async (context) => {
    const fixtureRoot = await createNuxtFixture("host-rspack", {
      moduleFederation: {
        config: {
          shared: {
            vue: { import: false, requiredVersion: "^99.0.0" },
          },
        },
      },
    });
    context.after(() => rm(fixtureRoot, { force: true, recursive: true }));

    await assert.rejects(
      runCommand(process.execPath, [
        nuxtCliPath("host-rspack"),
        "build",
        fixtureRoot,
      ]),
      /Shared dependency "vue" .*requires version "\^99\.0\.0".*host provides "3\.5\.40"/,
    );
  },
);

test(
  "Rspack honors explicit SSR externals in the published remote graph",
  { timeout: 60_000 },
  async (context) => {
    const fixtureRoot = await createNuxtFixture("remote-rspack", {
      moduleFederation: {
        config: {
          ssrExternals: ["defu"],
          exposes: { "./external-value": "./app/external-value.ts" },
        },
      },
    });
    context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
    await writeFile(
      resolve(fixtureRoot, "app/external-value.ts"),
      'import { defu } from "defu";\nexport const merge = defu;\n',
    );
    await runCommand(process.execPath, [
      nuxtCliPath("remote-rspack"),
      "build",
      fixtureRoot,
    ]);
    const publicRoot = resolve(fixtureRoot, ".output/public");
    const graph = await readRelativeModuleGraph(
      publicRoot,
      resolve(publicRoot, "rspack-remote-mf/remoteEntry.ssr.js"),
    );
    assert.match(
      [...graph.values()].join("\n"),
      /\bimport\s[^;]*from\s*["']defu["']/,
      "explicit SSR external was bundled into the remote",
    );
  },
);

test(
  "Rspack SPA remotes publish browser assets without claiming an SSR entry",
  { timeout: 60_000 },
  async (context) => {
    const fixtureRoot = await createNuxtFixture("remote-rspack", {
      ssr: false,
    });
    context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
    await runCommand(process.execPath, [
      nuxtCliPath("remote-rspack"),
      "build",
      fixtureRoot,
    ]);
    const publicRoot = resolve(fixtureRoot, ".output/public/rspack-remote-mf");
    assert.ok(existsSync(resolve(publicRoot, "remoteEntry.js")));
    const manifest = JSON.parse(
      await readFile(resolve(publicRoot, "mf-manifest.json"), "utf8"),
    );
    assert.equal(manifest.metaData.ssrRemoteEntry, undefined);
  },
);

test(
  "Rspack shared Vue SSR rejects Nitro bundling a separate host runtime",
  { timeout: 30_000 },
  async (context) => {
    const fixtureRoot = await createNuxtFixture("remote-rspack", {
      experimental: { externalVue: false },
    });
    context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
    await assert.rejects(
      runCommand(process.execPath, [
        nuxtCliPath("remote-rspack"),
        "build",
        fixtureRoot,
      ]),
      /Rspack SSR with shared Vue requires experimental\.externalVue/,
    );
  },
);
