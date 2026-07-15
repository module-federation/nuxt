import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { isMfRemoteEntryImporter } from "../packages/nuxt/src/runtime-plugin-importer.ts";
import {
  assertUniqueRemoteComponents,
  createRemoteComponent,
  createRemoteRefProxy,
} from "../packages/nuxt/src/remote-component-utils.ts";
import {
  createPortableResolvedShared,
  createSsrEntryLoaderPlugin,
  mergeSsrRequiredPackageNames,
  mergeSsrRuntimePackageNames,
  selectSsrRuntimePackageNames,
} from "../packages/nuxt/src/ssr-entry-loader-config.ts";
import { assertPortableSsrOutputGraph } from "../packages/nuxt/src/server-output-portability.ts";
import { createSsrOutputFingerprint } from "../packages/nuxt/src/server-output-fingerprint.ts";
import { repoRoot } from "./helpers/release.mjs";

const nuxtPackageRequire = createRequire(
  resolve(repoRoot, "packages/nuxt/package.json"),
);

test("remote component exports remain valid and reject name collisions", () => {
  assert.equal(
    createRemoteComponent("123", "Widget", 1).exportName,
    "mfRemote123_Widget",
  );

  assert.throws(
    () =>
      assertUniqueRemoteComponents([
        createRemoteComponent("remote", "Foo-Bar", 1),
        createRemoteComponent("remote", "Foo_Bar", 1),
      ]),
    /both normalize to the same Nuxt component/,
  );
});

test("remote component refs forward exposed object semantics", () => {
  let remote;
  const facade = createRemoteRefProxy({}, () => remote);
  assert.equal(Reflect.set(facade, "pending", true), true);
  assert.equal("pending" in facade, false);

  remote = {
    count: 1,
    reset() {
      return this;
    },
  };
  assert.deepEqual(Object.keys(facade).sort(), ["count", "reset"]);
  assert.equal(facade.reset(), remote);
  assert.equal(
    Reflect.getOwnPropertyDescriptor(facade, "count")?.configurable,
    true,
  );
  facade.count = 2;
  assert.equal(remote.count, 2);
});

test("SSR loader aliases only generated federation runtime imports", () => {
  for (const importer of [
    "virtual:mf-REMOTE_ENTRY_ID:__mfe_internal__host__remoteEntry_js",
    "\0virtual:mf-REMOTE_ENTRY_ID:host",
    "/@id/virtual:mf-REMOTE_ENTRY_ID:host",
    "/@id/__x00__virtual:mf-REMOTE_ENTRY_ID:host",
  ]) {
    assert.equal(isMfRemoteEntryImporter(importer), true, importer);
  }

  for (const importer of [
    undefined,
    "/app/plugins/federation.server.ts",
    "/packages/nuxt/dist/ssr-entry-loader.mjs",
    "virtual:mf:__mfe_internal__host__runtimeInit__",
  ]) {
    assert.equal(isMfRemoteEntryImporter(importer), false, importer);
  }
});

test("disabled remote SSR suppresses MF Vite's writable default loader", () => {
  assert.deepEqual(createSsrEntryLoaderPlugin(false, { hostName: "host" }), [
    "@module-federation/vite/ssrEntryLoader",
    { disabled: true },
  ]);
});

test("portable SSR loader keeps runtime support package names portable", () => {
  const runtimePackages = mergeSsrRuntimePackageNames(
    ["configured-package"],
    ["@module-federation/runtime", "@module-federation/sdk"],
  );

  assert.deepEqual(runtimePackages, [
    "configured-package",
    "@module-federation/runtime",
    "@module-federation/sdk",
  ]);
});

test("SSR dependencies stay separate from rewritten runtime packages", () => {
  assert.deepEqual(
    mergeSsrRequiredPackageNames(
      ["configured-required"],
      ["@module-federation/runtime", "vue-router", "external-only"],
    ),
    [
      "configured-required",
      "@module-federation/runtime",
      "vue-router",
      "external-only",
    ],
  );
  assert.deepEqual(
    mergeSsrRuntimePackageNames(
      ["explicit-runtime"],
      ["@module-federation/runtime"],
    ),
    ["explicit-runtime", "@module-federation/runtime"],
  );
  assert.deepEqual(
    selectSsrRuntimePackageNames(
      ["@module-federation/runtime", "@module-federation/sdk"],
      ["@module-federation/runtime"],
    ),
    ["@module-federation/sdk"],
    "shared runtime support must retain bare ESM import semantics",
  );
});

test("portable SSR loader rejects app-local absolute shared mappings", () => {
  const appRoot = resolve(repoRoot, "apps/host");

  assert.throws(
    () =>
      createPortableResolvedShared(
        { "local-shim": resolve(appRoot, "package.json") },
        appRoot,
      ),
    /Cannot make resolvedShared mapping "local-shim" .* portable/,
  );
});

test("package exports resolve under require conditions", () => {
  assert.equal(
    nuxtPackageRequire.resolve("@module-federation/nuxt"),
    resolve(repoRoot, "packages/nuxt/dist/federation.mjs"),
  );
  assert.equal(
    nuxtPackageRequire.resolve("@module-federation/nuxt/shared-strategy"),
    resolve(repoRoot, "packages/nuxt/dist/shared-strategy.mjs"),
  );
  assert.equal(
    nuxtPackageRequire.resolve("@module-federation/nuxt/ssr-entry-loader"),
    resolve(repoRoot, "packages/nuxt/dist/ssr-entry-loader.mjs"),
  );
});

test("SSR output fingerprints include server-only module changes", () => {
  const entryFile = "remoteEntry.ssr.js";
  const createBundle = (value) => ({
    [entryFile]: {
      code: `export const serverOnly = ${JSON.stringify(value)};`,
      dynamicImports: [],
      fileName: entryFile,
      imports: [],
      type: "chunk",
    },
  });
  const outputFiles = new Set([entryFile]);
  const outputChunks = new Set([entryFile]);

  assert.notEqual(
    createSsrOutputFingerprint(
      createBundle("first"),
      outputFiles,
      outputChunks,
    ),
    createSsrOutputFingerprint(
      createBundle("second"),
      outputFiles,
      outputChunks,
    ),
  );
});

test("SSR publisher rejects absolute build-machine imports", () => {
  const fileName = "chunks/expose.js";
  const createBundle = (specifier) => ({
    [fileName]: {
      code: `import ${JSON.stringify(specifier)};`,
      dynamicImports: [],
      fileName,
      imports: [],
      type: "chunk",
    },
  });

  for (const specifier of [
    "/Users/builder/app/dependency.mjs",
    String.raw`C:\agent\app\dependency.mjs`,
    "file:///home/builder/app/dependency.mjs",
    "/@fs/home/builder/app/dependency.mjs",
  ]) {
    assert.throws(
      () =>
        assertPortableSsrOutputGraph(
          createBundle(specifier),
          new Set([fileName]),
        ),
      /contains non-portable import/,
    );
  }

  assert.doesNotThrow(() =>
    assertPortableSsrOutputGraph(
      createBundle("../portable-dependency.mjs"),
      new Set([fileName]),
    ),
  );
});
