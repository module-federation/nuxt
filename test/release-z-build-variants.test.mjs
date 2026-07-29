import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { extname, resolve } from "node:path";
import test from "node:test";
import {
  assertManifestAssetsExist,
  assertPublishedSsrExposeGraph,
  createNuxtFixture,
  nuxtCliPath,
  readRelativeModuleGraph,
  runCommand,
  walkFiles,
} from "./helpers/release.mjs";

test(
  "MF Vite's test-environment no-op remains a no-op",
  { timeout: 45_000 },
  async (context) => {
    const fixtureRoot = await createNuxtFixture("remote");
    context.after(() => rm(fixtureRoot, { force: true, recursive: true }));

    await runCommand(
      process.execPath,
      [nuxtCliPath("remote"), "build", fixtureRoot],
      {
        env: {
          ...process.env,
          NODE_ENV: "test",
        },
      },
    );
  },
);

test(
  "disabled remote SSR does not bundle the writable cache loader",
  { timeout: 45_000 },
  async (context) => {
    const fixtureRoot = await createNuxtFixture("host", {
      moduleFederation: {
        ssr: false,
        config: {
          shared: {
            "remote-provided-package": { import: false },
          },
        },
      },
    });
    context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
    await runCommand(process.execPath, [
      nuxtCliPath("host"),
      "build",
      fixtureRoot,
    ]);

    const serverOutput = resolve(fixtureRoot, ".output/server");
    const sources = await Promise.all(
      (await walkFiles(serverOutput))
        .filter((path) => [".js", ".mjs"].includes(extname(path)))
        .map((path) => readFile(path, "utf8")),
    );
    const bundledSource = sources.join("\n");
    assert.doesNotMatch(bundledSource, /\.ssr-cache/);
  },
);

test(
  "client-only remote consumption still publishes server exposes",
  { timeout: 45_000 },
  async (context) => {
    const ssrEntryFile = "entries/remoteEntry.ssr.js";
    const fixtureRoot = await createNuxtFixture("remote", {
      app: { buildAssetsDir: "/_assets/" },
      experimental: { viteEnvironmentApi: true },
      moduleFederation: {
        ssr: false,
        config: {
          filename: "entries/remoteEntry.js",
        },
      },
    });
    const outputRoot = resolve(fixtureRoot, ".output");
    context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
    await runCommand(process.execPath, [
      nuxtCliPath("remote"),
      "build",
      fixtureRoot,
    ]);

    assert.ok(
      existsSync(resolve(outputRoot, "public/_mf", ssrEntryFile)),
      "ssr: false removed the remote's server entry",
    );
    await assertPublishedSsrExposeGraph(
      resolve(outputRoot, "public"),
      "Environment API client-only remote build",
      ssrEntryFile,
    );
    const publicRoot = resolve(outputRoot, "public");
    await readRelativeModuleGraph(
      publicRoot,
      resolve(publicRoot, "_mf/entries/remoteEntry.js"),
    );
    const manifestAssetCounts = await assertManifestAssetsExist(publicRoot);
    assert.ok(
      manifestAssetCounts.shared > 0,
      "custom build-assets fixture did not publish shared manifest assets",
    );
  },
);

test(
  "Nuxt SPA builds retain server federation compatibility",
  { timeout: 45_000 },
  async (context) => {
    const fixtureRoot = await createNuxtFixture("remote", {
      experimental: { viteEnvironmentApi: true },
      ssr: false,
    });
    const outputRoot = resolve(fixtureRoot, ".output");
    context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
    await runCommand(process.execPath, [
      nuxtCliPath("remote"),
      "build",
      fixtureRoot,
    ]);

    assert.ok(
      existsSync(resolve(outputRoot, "public/_mf/remoteEntry.ssr.js")),
      "Nuxt SPA build removed the remote's server entry",
    );
    await assertPublishedSsrExposeGraph(
      resolve(outputRoot, "public"),
      "Environment API SPA build",
    );
  },
);
