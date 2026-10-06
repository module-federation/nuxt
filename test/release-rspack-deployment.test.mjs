import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  getFreePort,
  repoRoot,
  startNitro,
  stopProcess,
  waitForResponse,
} from "./helpers/release.mjs";

test(
  "Rspack standalone SSR finds deployed dependencies from an external bootstrap",
  { timeout: 30_000 },
  async (context) => {
    const deployment = await mkdtemp(join(tmpdir(), "nuxt-mf-rspack-deploy-"));
    const launch = await mkdtemp(join(tmpdir(), "nuxt-mf-rspack-launch-"));
    const processes = [];
    context.after(async () => {
      await Promise.all(processes.map(stopProcess));
      await Promise.all(
        [deployment, launch].map((path) =>
          rm(path, { recursive: true, force: true }),
        ),
      );
    });

    await cp(
      resolve(repoRoot, "apps/host-rspack/.output"),
      resolve(deployment, ".output"),
      { recursive: true },
    );
    const remote = startNitro("remote-rspack", 4176);
    processes.push(remote);
    await waitForResponse(
      "http://127.0.0.1:4176/rspack-remote-mf/mf-manifest.json",
      remote,
      ({ status }) => status === 200,
    );

    const port = await getFreePort();
    const entry = resolve(deployment, ".output/server/index.mjs");
    // Importing from -e leaves argv[1] absent, and the empty working directory
    // cannot supply dependencies. The loader must resolve from its deployed URL.
    const host = spawn(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `await import(${JSON.stringify(pathToFileURL(entry).href)})`,
      ],
      {
        cwd: launch,
        env: {
          ...process.env,
          NODE_ENV: "production",
          HOST: "127.0.0.1",
          PORT: String(port),
          NODE_OPTIONS: [
            process.env.NODE_OPTIONS,
            "--dns-result-order=ipv4first",
          ]
            .filter(Boolean)
            .join(" "),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    processes.push(host);
    host.output = "";
    for (const stream of [host.stdout, host.stderr]) {
      stream.on("data", (chunk) => {
        host.output = `${host.output}${chunk}`.slice(-12_000);
      });
    }
    const response = await waitForResponse(`http://127.0.0.1:${port}/`, host);
    assert.equal(response.status, 200, host.output);
    assert.match(response.body, /Rendered by remote before client hydration\./);
    assert.equal(
      await realpath(resolve(launch, "node_modules/.ssr-cache/node_modules")),
      await realpath(resolve(deployment, ".output/server/node_modules")),
      "Rspack SSR cache must use the copied deployment's dependencies",
    );
  },
);
