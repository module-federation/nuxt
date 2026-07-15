import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  getFreePort,
  isReachable,
  repoRoot,
  startNitro,
  stopProcess,
  waitForResponse,
} from "./helpers/release.mjs";

const remotePort = 4174;
const remoteSsrMarker = "Rendered by remote before client hydration.";
const sharedVueContextMarker = "Connected to the host Vue SSR context.";

test(
  "an SSR outage fallback does not poison later remote loads",
  { timeout: 45_000 },
  async (context) => {
    const occupied = await isReachable(`http://127.0.0.1:${remotePort}/`);
    assert.equal(
      occupied,
      false,
      `port ${remotePort} must be free so the test can simulate an outage`,
    );

    const hostPort = await getFreePort();
    const hostCwd = await mkdtemp(join(tmpdir(), "nuxt-mf-host-cwd-"));
    const staleCacheDirectory = resolve(hostCwd, "node_modules/.ssr-cache");
    const cacheNodeModules = resolve(staleCacheDirectory, "node_modules");
    await mkdir(staleCacheDirectory, { recursive: true });
    await symlink(
      resolve(repoRoot, "node_modules"),
      cacheNodeModules,
      process.platform === "win32" ? "junction" : "dir",
    );
    const host = startNitro("host", hostPort, hostCwd);
    context.after(async () => {
      await stopProcess(host);
      await rm(hostCwd, { force: true, recursive: true });
    });

    const firstResponse = await waitForResponse(
      `http://127.0.0.1:${hostPort}/`,
      host,
    );
    assert.equal(firstResponse.status, 200);
    assert.equal(
      await realpath(cacheNodeModules),
      await realpath(
        resolve(repoRoot, "apps/host/.output/server/node_modules"),
      ),
      "the portable SSR cache did not replace its stale dependency link",
    );
    assert.match(
      firstResponse.body,
      /Rendered by host before client hydration\./,
    );
    assert.doesNotMatch(firstResponse.body, new RegExp(remoteSsrMarker));

    const remote = startNitro("remote", remotePort);
    context.after(() => stopProcess(remote));
    await waitForResponse(`http://127.0.0.1:${remotePort}/`, remote);

    const response = await fetch(`http://127.0.0.1:${hostPort}/`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const recoveredResponse = {
      body: await response.text(),
      status: response.status,
    };

    assert.equal(recoveredResponse.status, 200);
    assert.match(
      recoveredResponse.body,
      new RegExp(remoteSsrMarker),
      "the first SSR request after remote recovery did not render the remote",
    );
    assert.match(
      recoveredResponse.body,
      new RegExp(sharedVueContextMarker),
      "the remote did not reuse Nuxt's Vue SSR context",
    );
  },
);

test(
  "an imported Nitro server finds its deployed dependencies without a usable argv entry",
  { timeout: 45_000 },
  async (context) => {
    const remote = startNitro("remote", remotePort);
    context.after(() => stopProcess(remote));
    await waitForResponse(`http://127.0.0.1:${remotePort}/`, remote);

    const deploymentRoot = await mkdtemp(
      join(tmpdir(), "nuxt-mf-deployed-output-"),
    );
    const launchRoot = await mkdtemp(join(tmpdir(), "nuxt-mf-bootstrap-"));
    const deployedOutput = resolve(deploymentRoot, ".output");
    const deployedServer = resolve(deployedOutput, "server");
    await cp(resolve(repoRoot, "apps/host/.output"), deployedOutput, {
      recursive: true,
    });
    const deployedEntry = resolve(deployedServer, "index.mjs");
    const entrySource = await readFile(deployedEntry, "utf8");
    await writeFile(
      deployedEntry,
      entrySource.replace(
        "globalThis._importMeta_={url:import.meta.url",
        "globalThis._importMeta_={url:process.env.NUXT_MF_TEST_IMPORT_META_URL||import.meta.url",
      ),
    );
    context.after(async () => {
      await rm(deploymentRoot, { force: true, recursive: true });
      await rm(launchRoot, { force: true, recursive: true });
    });

    const nestedLoader = resolve(
      deployedServer,
      "chunks/closer/ssr-entry-loader.mjs",
    );
    await mkdir(resolve(dirname(nestedLoader), "node_modules"), {
      recursive: true,
    });

    const launches = [
      { name: "absent" },
      {
        name: "misleading",
        loaderUrl: pathToFileURL(nestedLoader).href,
      },
      {
        argvEntry: resolve(deployedServer, "index.mjs"),
        loaderUrl: "file:///_entry.js",
        name: "synthetic-loader-url",
      },
    ];

    for (const launch of launches) {
      const hostPort = await getFreePort();
      const hostCwd = resolve(launchRoot, launch.name);
      await mkdir(hostCwd, { recursive: true });
      const argvEntry =
        launch.argvEntry ||
        (launch.name === "misleading"
          ? resolve(hostCwd, "unrelated-bootstrap.mjs")
          : undefined);
      const host = startImportedNitro(
        deployedEntry,
        hostPort,
        hostCwd,
        argvEntry,
        launch.loaderUrl,
      );
      context.after(() => stopProcess(host));

      const response = await waitForResponse(
        `http://127.0.0.1:${hostPort}/`,
        host,
      );
      assert.equal(response.status, 200);
      assert.equal(
        await realpath(
          resolve(hostCwd, "node_modules/.ssr-cache/node_modules"),
        ),
        await realpath(resolve(deployedServer, "node_modules")),
        `the imported server used the ${launch.name} bootstrap path instead of its deployed dependencies`,
      );

      await stopProcess(host);
    }
  },
);

function startImportedNitro(entry, port, cwd, argvEntry, loaderUrl) {
  assert.ok(existsSync(entry), "host server output is missing");

  const args = [
    "--input-type=module",
    "--eval",
    `await import(${JSON.stringify(pathToFileURL(entry).href)});`,
  ];
  if (argvEntry) args.push(argvEntry);

  const child = spawn(process.execPath, args, {
    cwd,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      NODE_ENV: "production",
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--dns-result-order=ipv4first"]
        .filter(Boolean)
        .join(" "),
      PORT: String(port),
      ...(loaderUrl ? { NUXT_MF_TEST_IMPORT_META_URL: loaderUrl } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.output = "";

  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      child.output = `${child.output}${chunk}`.slice(-12_000);
    });
  }

  return child;
}
