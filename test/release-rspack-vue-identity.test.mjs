import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readRelativeModuleGraph, repoRoot } from "./helpers/release.mjs";

const publicRoot = resolve(repoRoot, "apps/remote-rspack/.output/public");
const entry = resolve(publicRoot, "rspack-remote-mf/remoteEntry.ssr.js");

test(
  "Rspack federated server components use the host's only Vue runtime",
  { timeout: 30_000 },
  async (context) => {
    const deployment = await mkdtemp(join(tmpdir(), "nuxt-mf-vue-identity-"));
    context.after(() => rm(deployment, { recursive: true, force: true }));

    // Reproduce the SSR cache's dependency boundary: only published remote
    // modules and the consuming host's deployed dependencies are available.
    const graph = await readRelativeModuleGraph(publicRoot, entry);
    for (const [path, source] of graph) {
      const destination = resolve(
        deployment,
        "public",
        relative(publicRoot, path),
      );
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, source);
    }
    await symlink(
      resolve(repoRoot, "apps/host-rspack/.output/server/node_modules"),
      resolve(deployment, "node_modules"),
      "dir",
    );
    await writeFile(resolve(deployment, "package.json"), '{"type":"module"}\n');
    await writeFile(
      resolve(deployment, "probe.mjs"),
      await readFile(
        fileURLToPath(
          new URL("./helpers/rspack-vue-identity.mjs", import.meta.url),
        ),
        "utf8",
      ),
    );

    // A separate process prevents previous tests or cached federation globals
    // from masking the registration of a second Vue runtime.
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [resolve(deployment, "probe.mjs")],
      {
        cwd: deployment,
        env: { ...process.env, NODE_ENV: "production" },
        timeout: 20_000,
      },
    );
    assert.match(stdout, /Host and remote share one Vue runtime/);
  },
);

test(
  "Rspack's published SSR graph does not embed Vue runtime or renderer copies",
  { timeout: 5_000 },
  async () => {
    const graph = await readRelativeModuleGraph(publicRoot, entry);
    for (const [path, source] of graph) {
      assert.equal(
        /\*\s+@vue\/(?:runtime-core|server-renderer|compiler-ssr)\s+v\d/.test(
          source,
        ),
        false,
        `${relative(publicRoot, path)} embeds a private Vue SSR dependency`,
      );
    }
  },
);
