import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { readdir, readFile, realpath } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export async function assertPublishedSsrExposeGraph(
  publicRoot,
  buildLabel,
  entryFile = "remoteEntry.ssr.js",
) {
  const entryPath = resolve(publicRoot, "_mf", entryFile);
  assert.ok(existsSync(entryPath), `${buildLabel} SSR entry is missing`);

  const graph = await readRelativeModuleGraph(publicRoot, entryPath);
  const source = [...graph.values()].join("\n");
  const exposedModules = [];
  for (const [path, moduleSource] of graph) {
    if (
      !/Object\.defineProperty\([^,]+,\s*["']__esModule["']/.test(moduleSource)
    ) {
      continue;
    }

    for (const specifier of findModuleImports(moduleSource)) {
      if (!specifier.startsWith(".")) continue;

      const importedPath = await realpath(
        resolve(dirname(path), specifier.replace(/[?#].*$/, "")),
      );
      const exposedSource = graph.get(importedPath);
      if (exposedSource) exposedModules.push([importedPath, exposedSource]);
    }
  }
  assert.ok(
    exposedModules.length > 0,
    `${buildLabel} SSR entry does not reach any exposed modules`,
  );
  for (const [path, exposedSource] of exposedModules) {
    assert.match(
      exposedSource,
      /__ssrInlineRender|ssrRender(?:Attrs|Component)/,
      `${buildLabel} expose ${relative(publicRoot, path)} is not server-transformed`,
    );
  }
  assert.doesNotMatch(
    source,
    /document\.createElement/,
    `${buildLabel} SSR entry reaches a browser-transformed expose`,
  );
  assert.doesNotMatch(
    source,
    /sourceMappingURL/,
    `${buildLabel} SSR graph references unpublished source maps`,
  );
  assert.doesNotMatch(
    source,
    /(?:\bfrom|\bimport\s*(?:\(\s*)?)\s*["'][^"']*\bdefu(?:@[^"'\/\\]+)?(?:[\/\\][^"']*)?["']/,
    `${buildLabel} SSR graph externalized the remote-only defu dependency`,
  );
  assert.doesNotMatch(
    source,
    /__mf_ssr_expose/,
    `${buildLabel} SSR graph leaked its internal bundling query`,
  );
  for (const [path, moduleSource] of graph) {
    for (const specifier of findModuleImports(moduleSource)) {
      assert.equal(
        isNonPortableModuleSpecifier(specifier),
        false,
        `${buildLabel} SSR graph contains non-portable import ${JSON.stringify(specifier)} in ${relative(publicRoot, path)}`,
      );
    }
  }
}

export async function assertManifestAssetsExist(publicRoot) {
  const manifestPath = resolve(publicRoot, "_mf/mf-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const assets = (manifest.exposes || []).flatMap((expose) =>
    ["js", "css"].flatMap((type) =>
      ["sync", "async"].flatMap(
        (loadType) => expose.assets?.[type]?.[loadType] || [],
      ),
    ),
  );

  for (const asset of assets) {
    const assetPath = resolve(dirname(manifestPath), asset);
    assert.ok(
      isWithinDirectory(assetPath, publicRoot),
      `manifest asset escaped the public root: ${asset}`,
    );
    assert.ok(existsSync(assetPath), `manifest asset is missing: ${asset}`);
  }
}

export async function readRelativeModuleGraph(publicRoot, entryPath) {
  const resolvedPublicRoot = await realpath(publicRoot);
  const pending = [await realpath(entryPath)];
  const sources = new Map();

  while (pending.length > 0) {
    const path = pending.pop();
    if (sources.has(path)) continue;

    assert.ok(
      isWithinDirectory(path, resolvedPublicRoot),
      `module graph escaped the public root: ${path}`,
    );
    const source = await readFile(path, "utf8");
    sources.set(path, source);

    for (const specifier of findModuleImports(source)) {
      if (!specifier.startsWith(".")) continue;

      const cleanSpecifier = specifier.replace(/[?#].*$/, "");
      const importedPath = resolve(dirname(path), cleanSpecifier);
      assert.ok(
        isWithinDirectory(importedPath, resolvedPublicRoot),
        `module import escaped the public root: ${specifier}`,
      );
      assert.ok(
        existsSync(importedPath),
        `module import is missing: ${relative(resolvedPublicRoot, importedPath)}`,
      );

      const resolvedImport = await realpath(importedPath);
      assert.ok(
        isWithinDirectory(resolvedImport, resolvedPublicRoot),
        `module import resolves outside the public root: ${specifier}`,
      );
      if (!sources.has(resolvedImport)) pending.push(resolvedImport);
    }
  }

  return sources;
}

function findModuleImports(source) {
  const imports = new Set();
  const patterns = [
    /\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g,
    /\bimport(?!\s*\()\s*(?:[^"'`;]*?\bfrom\s*)?(["'])([^"']+)\1/g,
    /\bexport\s+[^"'`;]*?\bfrom\s*(["'])([^"']+)\1/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) imports.add(match[2]);
  }

  return imports;
}

function isNonPortableModuleSpecifier(specifier) {
  return (
    specifier.startsWith("/") ||
    specifier.startsWith("\\\\") ||
    /^[a-zA-Z]:[\\/]/.test(specifier) ||
    /^file:/i.test(specifier)
  );
}

function isWithinDirectory(path, directory) {
  const relativePath = relative(directory, path);
  return (
    relativePath === "" ||
    (!isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith("../") &&
      !relativePath.startsWith("..\\"))
  );
}

export async function walkFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(path)));
    if (entry.isFile()) files.push(path);
  }
  return files;
}

export function startNitro(app, port, cwd) {
  const entry = resolve(repoRoot, `apps/${app}/.output/server/index.mjs`);
  assert.ok(existsSync(entry), `${app} server output is missing`);

  const child = spawn(process.execPath, [entry], {
    cwd: cwd || dirname(entry),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      NODE_ENV: "production",
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--dns-result-order=ipv4first"]
        .filter(Boolean)
        .join(" "),
      PORT: String(port),
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

export async function waitForResponse(url, child, predicate = () => true) {
  const deadline = Date.now() + 20_000;
  let lastError;
  let lastResponse;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      assert.fail(
        `server exited with code ${child.exitCode} and signal ${child.signalCode} while waiting for ${url}\n${child.output}`,
      );
    }

    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      });
      lastResponse = { body: await response.text(), status: response.status };
      if (predicate(lastResponse)) return lastResponse;
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }

  assert.fail(
    [
      `timed out waiting for ${url}`,
      lastResponse ? `last status: ${lastResponse.status}` : undefined,
      lastError ? `last error: ${lastError.message}` : undefined,
      child.output,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export async function isReachable(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(500) });
    return true;
  } catch {
    return false;
  }
}

export async function getFreePort() {
  const server = createServer();
  server.unref();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const { port } = address;
  server.close();
  await once(server, "close");
  return port;
}

export async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  child.kill("SIGTERM");
  let forceKillTimer;
  await Promise.race([
    once(child, "exit"),
    new Promise(
      (resolveDelay) => (forceKillTimer = setTimeout(resolveDelay, 3_000)),
    ),
  ]);
  clearTimeout(forceKillTimer);

  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

export async function runCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
    });
  }

  const [exitCode] = await once(child, "exit");
  assert.equal(exitCode, 0, `${command} ${args.join(" ")} failed\n${output}`);
}
