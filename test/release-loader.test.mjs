import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { promisify } from "node:util";
import { createPortableResolvedShared } from "../packages/nuxt/src/ssr-entry-loader-config.ts";
import { repoRoot } from "./helpers/release.mjs";

const nuxtPackageRequire = createRequire(
  resolve(repoRoot, "packages/nuxt/package.json"),
);
const execFileAsync = promisify(execFile);

test(
  "available VM loading does not initialize the writable SSR cache",
  { skip: process.platform === "win32" },
  async (context) => {
    const cwd = await mkdtemp(join(tmpdir(), "nuxt-mf-read-only-vm-"));
    context.after(async () => {
      await chmod(cwd, 0o755);
      await rm(cwd, { force: true, recursive: true });
    });
    await chmod(cwd, 0o555);

    const builtLoader = resolve(
      repoRoot,
      "packages/nuxt/dist/ssr-entry-loader.mjs",
    );
    await execFileAsync(
      process.execPath,
      [
        "--experimental-vm-modules",
        "--input-type=module",
        "--eval",
        `import loader from ${JSON.stringify(pathToFileURL(builtLoader).href)}; loader({ hostName: "vm-test", strategy: "vm" });`,
      ],
      { cwd },
    );

    assert.equal(existsSync(resolve(cwd, "node_modules")), false);
  },
);

test(
  "portable SSR loader preserves options and stable remote containers",
  { timeout: 5_000 },
  async (context) => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "nuxt-mf-ssr-loader-"));
    const bridgeSymbol = Symbol.for("@module-federation/nuxt:ssr-runtime");
    const importConditionsProbe = resolve(
      repoRoot,
      "node_modules/.ssr-cache/import-conditions-probe.mjs",
    );
    context.after(async () => {
      delete globalThis.__NUXT_MF_TEST_CANDIDATE__;
      delete globalThis.__NUXT_MF_TEST_HOST__;
      delete globalThis.__NUXT_MF_TEST_OPTIONS__;
      delete globalThis.__NUXT_MF_TEST_REFRESH_ENTRIES__;
      delete globalThis.__NUXT_MF_TEST_REVALIDATIONS__;
      delete globalThis.__NUXT_MF_TEST_REFRESH_GATE__;
      delete globalThis[bridgeSymbol];
      await rm(importConditionsProbe, { force: true });
      await rm(fixtureRoot, { force: true, recursive: true });
    });

    const builtLoader = resolve(
      repoRoot,
      "packages/nuxt/dist/ssr-entry-loader.mjs",
    );
    assert.ok(existsSync(builtLoader), "build the Nuxt package before testing");

    const runtimeStub = resolve(fixtureRoot, "runtime.mjs");
    const viteStub = resolve(fixtureRoot, "vite-loader.mjs");
    const loaderFixture = resolve(
      fixtureRoot,
      "loader-package/dist/ssr-entry-loader.mjs",
    );
    const aliasPackageRoot = resolve(fixtureRoot, "node_modules/custom-alias");
    const aliasPackageFile = resolve(aliasPackageRoot, "index.mjs");
    const conditionalPackageRoot = resolve(
      fixtureRoot,
      "node_modules/conditional-shared",
    );
    const conditionalPackageFile = resolve(conditionalPackageRoot, "index.mjs");
    const runtimePackageRoot = resolve(
      fixtureRoot,
      "loader-package/node_modules/runtime-support",
    );
    const runtimePackageFile = resolve(runtimePackageRoot, "index.cjs");
    const mappedPackageRoot = resolve(fixtureRoot, "node_modules/test-shim");
    const mappedPackageFile = resolve(mappedPackageRoot, "dist/exact-shim.mjs");
    await Promise.all([
      mkdir(dirname(loaderFixture), { recursive: true }),
      mkdir(aliasPackageRoot, { recursive: true }),
      mkdir(conditionalPackageRoot, { recursive: true }),
      mkdir(runtimePackageRoot, { recursive: true }),
      mkdir(dirname(mappedPackageFile), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        resolve(aliasPackageRoot, "package.json"),
        JSON.stringify({
          exports: { import: "./index.mjs", require: "./index.cjs" },
          name: "custom-alias",
          type: "module",
        }),
      ),
      writeFile(aliasPackageFile, "export default 'esm';"),
      writeFile(
        resolve(aliasPackageRoot, "index.cjs"),
        "module.exports = 'cjs';",
      ),
      writeFile(
        resolve(conditionalPackageRoot, "package.json"),
        JSON.stringify({
          exports: { import: "./index.mjs", require: "./index.cjs" },
          name: "conditional-shared",
          type: "module",
        }),
      ),
      writeFile(conditionalPackageFile, "export default 'esm';"),
      writeFile(
        resolve(conditionalPackageRoot, "index.cjs"),
        "module.exports = 'cjs';",
      ),
      writeFile(
        resolve(runtimePackageRoot, "package.json"),
        JSON.stringify({
          exports: { import: "./index.mjs", require: "./index.cjs" },
          name: "runtime-support",
          type: "module",
        }),
      ),
      writeFile(
        resolve(runtimePackageRoot, "index.mjs"),
        "export default 'esm';",
      ),
      writeFile(runtimePackageFile, "module.exports = 'cjs';"),
      writeFile(
        resolve(mappedPackageRoot, "package.json"),
        JSON.stringify({
          exports: { ".": "./index.mjs" },
          name: "test-shim",
          version: "1.2.3",
        }),
      ),
      writeFile(
        resolve(mappedPackageRoot, "index.mjs"),
        "export default 'main';",
      ),
      writeFile(mappedPackageFile, "export default 'exact';"),
    ]);
    const runtimeConditionalPackageFile = await realpath(
      conditionalPackageFile,
    );
    const runtimeSupportPackageFile = await realpath(runtimePackageFile);
    const runtimeMappedPackageFile = await realpath(mappedPackageFile);
    const portableShared = createPortableResolvedShared(
      { "custom-alias": mappedPackageFile },
      fixtureRoot,
    );
    assert.deepEqual(portableShared.mappings, {
      "custom-alias": {
        packageName: "test-shim",
        packagePath: "dist/exact-shim.mjs",
        packageVersion: "1.2.3",
      },
    });
    assert.deepEqual(portableShared.traceIncludes, [mappedPackageFile]);
    assert.equal(
      JSON.stringify(portableShared.mappings).includes(fixtureRoot),
      false,
      "portable mapping embedded its build-machine root",
    );
    await writeFile(
      runtimeStub,
      `export function getInstance(predicate) {
      const host = globalThis.__NUXT_MF_TEST_HOST__;
      return host && predicate(host) ? host : undefined;
    }`,
    );
    await writeFile(
      viteStub,
      `export function revalidate() {
      globalThis.__NUXT_MF_TEST_REVALIDATIONS__ += 1;
    }
    export default function loader(options) {
      globalThis.__NUXT_MF_TEST_OPTIONS__ = options;
      return {
        name: "test-loader",
        async loadEntry({ remoteInfo }) {
          globalThis.__NUXT_MF_TEST_REFRESH_ENTRIES__.push(remoteInfo.entry);
          await globalThis.__NUXT_MF_TEST_REFRESH_GATE__;
          return globalThis.__NUXT_MF_TEST_CANDIDATE__;
        },
      };
    }`,
    );

    const runtimeSpecifier = JSON.stringify(pathToFileURL(runtimeStub).href);
    const viteSpecifier = JSON.stringify(pathToFileURL(viteStub).href);
    const loaderSource = (await readFile(builtLoader, "utf8"))
      .replaceAll(
        JSON.stringify("@module-federation/runtime"),
        runtimeSpecifier,
      )
      .replaceAll(
        JSON.stringify("@module-federation/vite/ssrEntryLoader"),
        viteSpecifier,
      );
    await writeFile(loaderFixture, loaderSource);

    const currentContainer = { get() {}, init() {} };
    const customManifestUrl =
      "http://remote.test/manifests/custom-manifest.json?channel=stable";
    const forcedRemoteNames = [];
    const host = {
      async loadRemote(importPath) {
        if (importPath === "remote/Missing") {
          throw new Error("missing expose");
        }
        return { default: importPath };
      },
      moduleCache: new Map([
        [
          "remote",
          {
            remoteEntryExports: currentContainer,
            remoteInfo: {
              entry: "http://remote.test/remoteEntry.ssr.js",
              name: "remote",
              version: customManifestUrl,
            },
          },
        ],
        [
          "healthy",
          {
            remoteEntryExports: { get() {}, init() {} },
            remoteInfo: {
              entry: "http://healthy.test/mf-manifest.json",
              name: "healthy",
            },
          },
        ],
      ]),
      options: {
        name: "test-host",
        remotes: [
          {
            entry: "http://remote.test/entries/remoteEntry.js",
            name: "remote",
          },
          {
            entry: "http://healthy.test/mf-manifest.json",
            name: "healthy",
          },
        ],
      },
      registerRemotes(remotes) {
        forcedRemoteNames.push(...remotes.map((remote) => remote.name));
      },
    };
    globalThis.__NUXT_MF_TEST_CANDIDATE__ = currentContainer;
    globalThis.__NUXT_MF_TEST_HOST__ = host;
    globalThis.__NUXT_MF_TEST_REFRESH_ENTRIES__ = [];
    globalThis.__NUXT_MF_TEST_REVALIDATIONS__ = 0;

    const { default: portableSsrEntryLoader } = await import(
      pathToFileURL(loaderFixture).href
    );
    const plugin = portableSsrEntryLoader({
      fetchTimeoutMs: 10,
      hostName: "test-host",
      maxAgeMs: 0,
      portableResolvedShared: portableShared.mappings,
      requiredPackages: ["conditional-shared"],
      runtimePackages: ["runtime-support"],
      shareScopeName: "custom",
      strategy: "vm",
    });
    assert.equal(
      await realpath(
        resolve(
          repoRoot,
          "node_modules/.ssr-cache/node_modules/conditional-shared/index.mjs",
        ),
      ),
      runtimeConditionalPackageFile,
      "the deployed SSR cache did not retain the external's ESM entry",
    );
    await writeFile(
      importConditionsProbe,
      'import value from "conditional-shared"; export default value;',
    );
    assert.equal(
      (await import(pathToFileURL(importConditionsProbe).href)).default,
      "esm",
      "the deployed bare external did not use its import export condition",
    );

    assert.deepEqual(globalThis.__NUXT_MF_TEST_OPTIONS__, {
      fetchTimeoutMs: 10,
      maxAgeMs: 0,
      resolvedShared: {
        "custom-alias": runtimeMappedPackageFile,
        "runtime-support": runtimeSupportPackageFile,
      },
      shareScopeName: "custom",
      strategy: "vm",
    });
    assert.equal(
      Object.values(
        globalThis.__NUXT_MF_TEST_OPTIONS__.resolvedShared,
      ).includes(runtimeConditionalPackageFile),
      false,
      "an ESM MF singleton was resolved through CommonJS conditions",
    );

    const { ModuleFederation } = await import(
      pathToFileURL(nuxtPackageRequire.resolve("@module-federation/runtime"))
        .href
    );
    const manifestFetchArgs = [
      "http://remote.test/mf-manifest.json",
      {},
      undefined,
      { resourceType: "manifest" },
    ];
    const originalFetch = globalThis.fetch;
    let rawFetches = 0;
    globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        rawFetches += 1;
        init.signal.addEventListener(
          "abort",
          () => reject(init.signal.reason),
          {
            once: true,
          },
        );
      });
    try {
      let customSignal;
      const customResponse = new Response("custom manifest");
      const customFetchPlugin = {
        name: "test-custom-manifest-fetch",
        fetch(_input, init) {
          customSignal = init.signal;
          return customResponse;
        },
      };
      const customFetchHost = new ModuleFederation({
        name: "test-custom-fetch-host",
        plugins: [customFetchPlugin, plugin],
      });
      assert.equal(
        await customFetchHost.loaderHook.lifecycle.fetch.emit(
          ...manifestFetchArgs,
        ),
        customResponse,
      );
      assert.ok(customSignal);
      assert.equal(rawFetches, 0);

      const lateResponse = new Response("late custom manifest");
      customFetchHost.registerPlugins([
        {
          name: "test-late-manifest-fetch",
          fetch() {
            return lateResponse;
          },
        },
      ]);
      assert.equal(
        await customFetchHost.loaderHook.lifecycle.fetch.emit(
          ...manifestFetchArgs,
        ),
        lateResponse,
      );
      assert.equal(
        await customFetchHost.loaderHook.lifecycle.fetch.emit(
          "http://remote.test/remoteEntry.js",
          {},
          undefined,
          { resourceType: "remoteEntry" },
        ),
        lateResponse,
      );
      assert.equal(rawFetches, 0);

      const fallbackFetchHost = new ModuleFederation({
        name: "test-fallback-fetch-host",
        plugins: [plugin],
      });
      await assert.rejects(
        fallbackFetchHost.loaderHook.lifecycle.fetch.emit(...manifestFetchArgs),
        (error) => error?.name === "TimeoutError",
      );
      assert.equal(rawFetches, 1);

      const hangingFetchHost = new ModuleFederation({
        name: "test-hanging-fetch-host",
        plugins: [
          {
            name: "test-hanging-manifest-fetch",
            fetch: () => new Promise(() => {}),
          },
          plugin,
        ],
      });
      await assert.rejects(
        hangingFetchHost.loaderHook.lifecycle.fetch.emit(...manifestFetchArgs),
        (error) => error?.name === "TimeoutError",
      );
      assert.equal(rawFetches, 1);

      const customError = new Error("custom manifest fetch failed");
      const throwingFetchHost = new ModuleFederation({
        name: "test-throwing-fetch-host",
        plugins: [
          {
            name: "test-throwing-manifest-fetch",
            fetch() {
              throw customError;
            },
          },
          plugin,
        ],
      });
      await assert.rejects(
        throwingFetchHost.loaderHook.lifecycle.fetch.emit(...manifestFetchArgs),
        (error) => error === customError,
      );
      assert.equal(rawFetches, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }

    globalThis.__NUXT_MF_TEST_CANDIDATE__ = undefined;
    let nodeFallbackFetches = 0;
    globalThis.fetch = async () => {
      nodeFallbackFetches += 1;
      throw new Error("unexpected browser-entry fallback");
    };
    try {
      const noSsrEntryHost = new ModuleFederation({
        name: "test-no-ssr-entry-host",
        remotes: [
          {
            entry: "https://unavailable.test/remoteEntry.js",
            name: "unavailable",
            type: "module",
          },
        ],
        plugins: [plugin],
      });
      await assert.rejects(
        noSsrEntryHost.loadRemote("unavailable/Widget"),
        /Failed to load an SSR entry for remote "unavailable"/,
      );
      assert.equal(
        nodeFallbackFetches,
        0,
        "runtime-core fetched the browser entry after the bounded SSR loader failed",
      );
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.__NUXT_MF_TEST_CANDIDATE__ = currentContainer;
      globalThis.__NUXT_MF_TEST_REFRESH_ENTRIES__.length = 0;
    }

    await plugin.loadEntry({
      origin: host,
      remoteInfo: host.moduleCache.get("remote").remoteInfo,
    });
    assert.deepEqual(globalThis.__NUXT_MF_TEST_REFRESH_ENTRIES__, [
      customManifestUrl,
    ]);
    globalThis.__NUXT_MF_TEST_REFRESH_ENTRIES__.length = 0;

    const bridge = globalThis[bridgeSymbol].get("test-host");
    bridge.markLoaded("remote");

    let releaseRefresh;
    globalThis.__NUXT_MF_TEST_REFRESH_GATE__ = new Promise((resolveRefresh) => {
      releaseRefresh = resolveRefresh;
    });
    const cachedLoad = bridge.load("remote", "remote/Widget");
    assert.equal(
      await Promise.race([
        cachedLoad.then(() => "loaded"),
        new Promise((resolveTimeout) =>
          setTimeout(() => resolveTimeout("timed-out"), 50),
        ),
      ]),
      "loaded",
      "cached remote waited for a background refresh",
    );
    releaseRefresh();
    await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
    delete globalThis.__NUXT_MF_TEST_REFRESH_GATE__;
    assert.deepEqual(forcedRemoteNames, [], "unchanged remote was reset");
    assert.deepEqual(globalThis.__NUXT_MF_TEST_REFRESH_ENTRIES__, [
      customManifestUrl,
    ]);

    globalThis.__NUXT_MF_TEST_CANDIDATE__ = { get() {}, init() {} };
    globalThis.__NUXT_MF_TEST_REFRESH_GATE__ = new Promise((resolveRefresh) => {
      releaseRefresh = resolveRefresh;
    });
    await bridge.load("remote", "remote/Widget");
    bridge.invalidate("remote");
    assert.deepEqual(forcedRemoteNames, ["remote"]);
    releaseRefresh();
    await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
    delete globalThis.__NUXT_MF_TEST_REFRESH_GATE__;
    assert.deepEqual(
      forcedRemoteNames,
      ["remote"],
      "an invalidated background refresh reset the recovered remote",
    );

    await bridge.load("remote", "remote/Widget");
    forcedRemoteNames.length = 0;
    globalThis.__NUXT_MF_TEST_CANDIDATE__ = { get() {}, init() {} };
    const [missingExpose, validExpose] = await Promise.allSettled([
      bridge.load("remote", "remote/Missing"),
      bridge.load("remote", "remote/Widget"),
    ]);
    assert.equal(missingExpose.status, "rejected");
    assert.equal(validExpose.status, "fulfilled");
    await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
    assert.deepEqual(
      forcedRemoteNames,
      ["remote"],
      "changed remote was not reset",
    );

    globalThis.__NUXT_MF_TEST_CANDIDATE__ = undefined;
    await bridge.load("remote", "remote/Widget");
    assert.deepEqual(
      forcedRemoteNames,
      ["remote"],
      "failed refresh discarded stale remote",
    );

    bridge.invalidate("remote");
    assert.deepEqual(forcedRemoteNames, ["remote", "remote"]);
    assert.equal(globalThis.__NUXT_MF_TEST_REVALIDATIONS__, 0);
    assert.ok(host.moduleCache.has("healthy"));
  },
);
