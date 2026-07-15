import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import {
  assertPublishedSsrExposeGraph,
  repoRoot,
  walkFiles,
} from "./helpers/release.mjs";

const execFileAsync = promisify(execFile);

const ssrRuntimePackages = [
  "@module-federation/runtime",
  "@module-federation/runtime-core",
  "@module-federation/sdk",
  "vue",
  "vue-router",
];

test("standalone server output contains no build-machine paths", async () => {
  const matches = [];
  for (const app of ["host", "remote"]) {
    const outputRoot = resolve(repoRoot, `apps/${app}/.output/server`);
    assert.ok(
      existsSync(outputRoot),
      `${app} output is missing; build the examples before running tests`,
    );

    for (const path of await walkFiles(outputRoot)) {
      if (![".js", ".json", ".mjs"].includes(extname(path))) continue;

      const source = await readFile(path, "utf8");
      if (source.includes(repoRoot)) {
        matches.push(relative(repoRoot, path));
      }
    }
  }

  assert.deepEqual(
    matches,
    [],
    `standalone output embeds the checkout path ${repoRoot}`,
  );

  const serverModules = resolve(
    repoRoot,
    "apps/host/.output/server/node_modules",
  );
  const missingPackages = ssrRuntimePackages.filter(
    (packageName) => !existsSync(resolve(serverModules, packageName)),
  );
  assert.deepEqual(
    missingPackages,
    [],
    "standalone output did not trace the SSR federation dependencies",
  );

  const vueRouterImportEntry = resolve(
    serverModules,
    "vue-router/vue-router.node.mjs",
  );
  assert.ok(
    existsSync(vueRouterImportEntry),
    "standalone output did not trace Vue Router's ESM import entry",
  );
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `const router = await import("vue-router");
       console.log(typeof router.createRouter);
       console.log(import.meta.resolve("vue-router"));`,
    ],
    { cwd: resolve(repoRoot, "apps/host/.output/server") },
  );
  assert.deepEqual(
    stdout.trim().split("\n"),
    ["function", pathToFileURL(vueRouterImportEntry).href],
    "standalone bare import did not select Vue Router's ESM export condition",
  );
});

test("server federation keeps Vue singletons external", async () => {
  const bundledVueSources = [];
  const bundledVuePattern =
    /(?:^|\/)node_modules\/(?:vue\/(?:dist\/|index\.)|vue-router\/dist\/|@vue\/(?:reactivity|runtime-core|runtime-dom|server-renderer)\/)/;

  for (const app of ["host", "remote"]) {
    const serverBuild = [
      resolve(repoRoot, `apps/${app}/.nuxt/dist/server`),
      resolve(
        repoRoot,
        `apps/${app}/node_modules/.cache/nuxt/.nuxt/dist/server`,
      ),
    ].find(existsSync);
    assert.ok(
      serverBuild,
      `${app} Vite server output is missing; build the examples before testing`,
    );

    for (const mapPath of (await walkFiles(serverBuild)).filter(
      (path) => extname(path) === ".map",
    )) {
      const sourceMap = JSON.parse(await readFile(mapPath, "utf8"));
      for (const source of sourceMap.sources ?? []) {
        if (bundledVuePattern.test(source.replaceAll("\\", "/"))) {
          bundledVueSources.push(`${relative(repoRoot, mapPath)}: ${source}`);
        }
      }
    }
  }

  assert.deepEqual(
    bundledVueSources,
    [],
    "server federation bundled a second Vue or Vue Router runtime",
  );
});

test("server federation keeps the Node target for dual Nuxt builds", async () => {
  const buildChunks = resolve(
    repoRoot,
    "apps/host/.output/server/chunks/build",
  );
  const remoteEntryPath = (await walkFiles(buildChunks)).find((path) =>
    basename(path).startsWith("virtual_mf-REMOTE_ENTRY_ID"),
  );
  assert.ok(remoteEntryPath, "host server federation control chunk is missing");

  const source = await readFile(remoteEntryPath, "utf8");
  assert.match(source, /const isBrowserEnvValue = false;/);
});

test("serial Nuxt builds publish server-transformed exposes", async () => {
  await assertPublishedSsrExposeGraph(
    resolve(repoRoot, "apps/remote/.output/public"),
    "serial Nuxt build",
  );
});

test("client manifests preserve the default Vue share scope", async () => {
  for (const app of ["host", "remote"]) {
    const manifestPath = resolve(
      repoRoot,
      `apps/${app}/.output/public/_mf/mf-manifest.json`,
    );
    assert.ok(
      existsSync(manifestPath),
      `${app} manifest is missing; build the examples before running tests`,
    );

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (app === "remote") {
      assert.match(
        manifest.metaData?.custom?.nuxtSsrBuildHash ?? "",
        /^sha256-[a-f\d]{64}$/,
        "remote manifest does not fingerprint its SSR module graph",
      );
    }
    const sharedNames = new Set(
      (manifest.shared ?? []).map((entry) => entry.name),
    );

    assert.ok(sharedNames.has("vue"), `${app} manifest does not share vue`);
    assert.ok(
      sharedNames.has("vue-router"),
      `${app} manifest does not share vue-router`,
    );
  }
});
