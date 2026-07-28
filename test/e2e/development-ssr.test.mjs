import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";
import {
  getFreePort,
  isReachable,
  repoRoot,
  stopProcess,
  waitForResponse,
} from "../helpers/release.mjs";

const ssrMarkers = [
  "Remote SSR component",
  "Rendered by remote before client hydration.",
  "Connected to the host Vue SSR context.",
  "Connected to the host Vue Router context.",
];

test(
  "development remotes reuse the host SSR contexts",
  { timeout: 60_000 },
  async (context) => {
    const remotePort = await getFreePort();

    // Exercise MF Vite's client-runner fallback on the remote while the host
    // uses Nuxt's Environment API. This is the identity boundary that used to
    // split Vue Router's injection keys during federated SSR.
    const remote = startNuxtDev("remote", remotePort, {
      NUXT_MF_ENVIRONMENT_API: "false",
    });
    context.after(() => stopProcess(remote));
    await waitForResponse(`http://127.0.0.1:${remotePort}/`, remote);

    const hostPort = await getFreePort();
    const host = startNuxtDev("host", hostPort, {
      NUXT_MF_REMOTE_URL: `http://127.0.0.1:${remotePort}/_mf/mf-manifest.json`,
    });
    context.after(() => stopProcess(host));
    const response = await waitForResponse(
      `http://127.0.0.1:${hostPort}/`,
      host,
      ({ body, status }) =>
        status === 200 && ssrMarkers.every((marker) => body.includes(marker)),
    );

    for (const marker of ssrMarkers) {
      assert.match(response.body, new RegExp(escapeRegExp(marker)));
    }
    assert.doesNotMatch(response.body, /injection.*router.*not found/i);
    assert.doesNotMatch(host.output, /injection.*router.*not found/i);

    const browser = await chromium.launch();
    context.after(() => browser.close());
    const page = await browser.newPage();
    const browserErrors = [];
    const remoteEntryRequests = [];
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
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.endsWith("/remoteEntry.js")) {
        remoteEntryRequests.push(url.href);
      }
    });

    await page.goto(`http://127.0.0.1:${hostPort}/`, {
      waitUntil: "networkidle",
    });

    const remoteCard = page.locator(".remote-ssr-card");
    await remoteCard.getByText("Hydrated", { exact: true }).waitFor();
    const remoteCounter = remoteCard.getByRole("button", {
      exact: true,
      name: "Remote counter: 0",
    });
    await remoteCounter.click();
    await remoteCard
      .getByRole("button", { exact: true, name: "Remote counter: 1" })
      .waitFor();

    const remoteOrigin = `http://127.0.0.1:${remotePort}`;
    assert.ok(
      remoteEntryRequests.some((url) => url.startsWith(remoteOrigin)),
      `remote entry was not loaded from ${remoteOrigin}: ${remoteEntryRequests.join(", ")}`,
    );
    assert.deepEqual(browserErrors, []);
  },
);

function startNuxtDev(app, port, env = {}) {
  const appRoot = resolve(repoRoot, "apps", app);
  const child = spawn(
    process.execPath,
    [
      resolve(appRoot, "node_modules/nuxt/bin/nuxt.mjs"),
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        ...env,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, "--dns-result-order=ipv4first"]
          .filter(Boolean)
          .join(" "),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.output = "";

  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      child.output = `${child.output}${chunk}`.slice(-20_000);
    });
  }

  return child;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
