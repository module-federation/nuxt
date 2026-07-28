import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nuxtDist = resolve(repoRoot, "packages/nuxt/dist");

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
