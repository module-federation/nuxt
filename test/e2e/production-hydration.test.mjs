import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const remotePort = 4174;

test(
  "production remotes hydrate without errors and remain interactive",
  { timeout: 45_000 },
  async (context) => {
    assert.equal(
      await isReachable(`http://127.0.0.1:${remotePort}/`),
      false,
      `port ${remotePort} must be free for the production browser test`,
    );

    const remote = startNitro("remote", remotePort);
    context.after(() => stopProcess(remote));
    await waitForResponse(`http://127.0.0.1:${remotePort}/`, remote);

    const hostPort = await getFreePort();
    const host = startNitro("host", hostPort);
    context.after(() => stopProcess(host));
    const hostResponse = await waitForResponse(
      `http://127.0.0.1:${hostPort}/`,
      host,
    );
    assert.match(
      await hostResponse.text(),
      /Connected to the host Vue Router context\./,
      "remote SSR did not reuse the host Vue Router injection keys",
    );

    const browser = await chromium.launch();
    context.after(() => browser.close());
    const page = await browser.newPage();
    const browserErrors = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" ||
        (message.type() === "warning" && /hydrat/i.test(message.text()))
      ) {
        browserErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) =>
      browserErrors.push(error.stack ?? error.message),
    );

    await page.goto(`http://127.0.0.1:${hostPort}/`, {
      waitUntil: "networkidle",
    });

    const remoteCard = page.locator(".remote-ssr-card");
    await remoteCard.waitFor({ state: "visible" });
    await remoteCard.getByText("Hydrated", { exact: true }).waitFor();
    assert.match(
      (await remoteCard.textContent()) ?? "",
      /Connected to the host Vue SSR context\./,
    );
    assert.match(
      (await remoteCard.textContent()) ?? "",
      /Connected to the host Vue Router context\./,
    );

    const remoteCounter = remoteCard.getByRole("button", {
      exact: true,
      name: "Remote counter: 0",
    });
    await remoteCounter.click();
    await remoteCard
      .getByRole("button", { exact: true, name: "Remote counter: 1" })
      .waitFor();

    const remoteWidget = page.locator(".remote-card");
    await remoteWidget
      .getByText("I'm the remote app", { exact: true })
      .waitFor();
    const widgetCounter = remoteWidget.getByRole("button", {
      exact: true,
      name: "Remote counter: 0",
    });
    await widgetCounter.click();
    await remoteWidget
      .getByRole("button", { exact: true, name: "Remote counter: 1" })
      .waitFor();

    assert.deepEqual(browserErrors, []);
  },
);

function startNitro(app, port) {
  const child = spawn(
    process.execPath,
    [resolve(repoRoot, `apps/${app}/.output/server/index.mjs`)],
    {
      cwd: repoRoot,
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
    },
  );
  child.output = "";
  child.stdout.on(
    "data",
    (chunk) => (child.output = `${child.output}${chunk}`.slice(-12_000)),
  );
  child.stderr.on(
    "data",
    (chunk) => (child.output = `${child.output}${chunk}`.slice(-12_000)),
  );
  return child;
}

async function stopProcess(child) {
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

async function waitForResponse(url, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Server exited before ${url} was ready:\n${child.output}`,
      );
    }
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return response;
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Timed out waiting for ${url}:\n${child.output}`);
}

async function isReachable(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(500) });
    return true;
  } catch {
    return false;
  }
}

async function getFreePort() {
  const server = createServer();
  server.unref();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const { port } = address;
  await new Promise((resolveClose, rejectClose) =>
    server.close((error) => (error ? rejectClose(error) : resolveClose())),
  );
  return port;
}
