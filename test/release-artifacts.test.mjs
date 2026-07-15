import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readNuxtViteBuilderVersion } from "../packages/nuxt/src/vite-version.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nuxtDist = resolve(repoRoot, "packages/nuxt/dist");

test("Nuxt builder Vite detection ignores an npm-hoisted peer Vite", async (context) => {
  const consumerRoot = await mkdtemp(join(tmpdir(), "nuxt-mf-npm-consumer-"));
  context.after(() => rm(consumerRoot, { force: true, recursive: true }));

  await writePackageJson(resolve(consumerRoot, "package.json"), {
    name: "clean-npm-consumer",
    private: true,
  });
  await writePackageJson(
    resolve(consumerRoot, "node_modules/vite/package.json"),
    {
      name: "vite",
      version: "8.1.4",
    },
  );
  await writePackageJson(
    resolve(consumerRoot, "node_modules/nuxt/package.json"),
    {
      name: "nuxt",
      version: "4.4.8",
      exports: {
        "./package.json": "./package.json",
      },
    },
  );

  const viteBuilderRoot = resolve(
    consumerRoot,
    "node_modules/@nuxt/vite-builder",
  );
  await writePackageJson(resolve(viteBuilderRoot, "package.json"), {
    name: "@nuxt/vite-builder",
    version: "4.4.8",
    type: "module",
    exports: {
      ".": "./dist/index.mjs",
    },
  });
  await mkdir(resolve(viteBuilderRoot, "dist"), { recursive: true });
  await writeFile(resolve(viteBuilderRoot, "dist/index.mjs"), "export {};\n");
  await writePackageJson(
    resolve(viteBuilderRoot, "node_modules/vite/package.json"),
    {
      name: "vite",
      version: "7.3.6",
    },
  );

  const consumerRequire = createRequire(resolve(consumerRoot, "package.json"));
  const hoistedVite = consumerRequire(
    consumerRequire.resolve("vite/package.json"),
  );

  assert.equal(hoistedVite.version, "8.1.4");
  assert.equal(readNuxtViteBuilderVersion(consumerRoot), "7.3.6");
});

test("published declarations do not reference missing source maps", async () => {
  const declarations = (await readdir(nuxtDist)).filter((fileName) =>
    fileName.endsWith(".d.mts"),
  );
  assert.ok(declarations.length > 0, "build the Nuxt package before testing");

  for (const declaration of declarations) {
    const source = await readFile(resolve(nuxtDist, declaration), "utf8");
    const sourceMapReference = source.match(
      /\/\/[#@]\s*sourceMappingURL=([^\s]+)\s*$/m,
    )?.[1];

    assert.ok(sourceMapReference, `${declaration} has no declaration map`);
    assert.ok(
      existsSync(resolve(nuxtDist, sourceMapReference)),
      `${declaration} references missing source map ${sourceMapReference}`,
    );
  }
});

async function writePackageJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
