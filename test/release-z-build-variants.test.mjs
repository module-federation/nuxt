import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  assertManifestAssetsExist,
  assertPublishedSsrExposeGraph,
  readRelativeModuleGraph,
  runCommand,
  walkFiles,
} from "./helpers/release.mjs";

test(
  "MF Vite's test-environment no-op remains a no-op",
  { timeout: 45_000 },
  async (context) => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "nuxt-mf-test-env-"));
    const buildDir = resolve(fixtureRoot, "build");
    const outputRoot = resolve(fixtureRoot, "output");
    context.after(() => rm(fixtureRoot, { force: true, recursive: true }));

    await runCommand(
      "pnpm",
      ["--filter", "nuxt-remote", "exec", "nuxt", "build"],
      {
        env: {
          ...process.env,
          NODE_ENV: "test",
          NUXT_MF_BUILD_DIR: buildDir,
          NUXT_MF_OUTPUT_DIR: outputRoot,
        },
      },
    );
  },
);

test(
  "disabled remote SSR does not bundle the writable cache loader",
  { timeout: 45_000 },
  async (context) => {
    const outputRoot = await mkdtemp(join(tmpdir(), "nuxt-mf-host-no-ssr-"));
    context.after(() => rm(outputRoot, { force: true, recursive: true }));
    await runCommand(
      "pnpm",
      ["--filter", "nuxt-host", "exec", "nuxt", "build"],
      {
        env: {
          ...process.env,
          NUXT_MF_OUTPUT_DIR: outputRoot,
          NUXT_MF_REMOTE_ONLY_SHARED: "true",
          NUXT_MF_REMOTE_SSR: "false",
        },
      },
    );

    const serverOutput = resolve(outputRoot, "server");
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
    const outputRoot = await mkdtemp(join(tmpdir(), "nuxt-mf-remote-no-ssr-"));
    const ssrEntryFile = "entries/remoteEntry.ssr.js";
    context.after(() => rm(outputRoot, { force: true, recursive: true }));
    await runCommand(
      "pnpm",
      ["--filter", "nuxt-remote", "exec", "nuxt", "build"],
      {
        env: {
          ...process.env,
          NUXT_MF_BUILD_ASSETS_DIR: "/_assets/",
          NUXT_MF_ENVIRONMENT_API: "true",
          NUXT_MF_FILENAME: "entries/remoteEntry.js",
          NUXT_MF_OUTPUT_DIR: outputRoot,
          NUXT_MF_REMOTE_SSR: "false",
        },
      },
    );

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
    await assertManifestAssetsExist(publicRoot);
  },
);

test(
  "Nuxt SPA builds retain server federation compatibility",
  { timeout: 45_000 },
  async (context) => {
    const outputRoot = await mkdtemp(join(tmpdir(), "nuxt-mf-remote-spa-"));
    context.after(() => rm(outputRoot, { force: true, recursive: true }));
    await runCommand(
      "pnpm",
      ["--filter", "nuxt-remote", "exec", "nuxt", "build"],
      {
        env: {
          ...process.env,
          NUXT_MF_ENVIRONMENT_API: "true",
          NUXT_MF_NUXT_SSR: "false",
          NUXT_MF_OUTPUT_DIR: outputRoot,
        },
      },
    );

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
