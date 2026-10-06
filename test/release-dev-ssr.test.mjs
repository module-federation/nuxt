import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import {
  createNuxtFixture,
  getFreePort,
  startNuxtDev,
  stopProcess,
  waitForResponse,
} from "./helpers/release.mjs";

test(
  "Nuxt dev resolves shared runtime imports in the SSR remote entry",
  { timeout: 45_000 },
  async (context) => {
    const serverPort = await getFreePort();
    const hmrPort = await getFreePort();
    const fixtureRoot = await createNuxtFixture("remote", {
      vite: { server: { hmr: { port: hmrPort } } },
    });
    const remote = startNuxtDev("remote", serverPort, fixtureRoot);

    context.after(async () => {
      await stopProcess(remote);
      await rm(fixtureRoot, { force: true, recursive: true });
    });

    const response = await waitForResponse(
      `http://127.0.0.1:${serverPort}/remoteEntry.ssr.js`,
      remote,
      ({ body, status }) =>
        status === 200 && body.includes("@module-federation/runtime"),
    );

    assert.equal(response.status, 200);
    assert.match(
      response.body,
      /from "\/_nuxt\/@fs\/.*\/\@module-federation\/runtime\/dist\/index\.js"/,
      "the SSR remote entry did not resolve the runtime to an absolute Vite module",
    );
    assert.doesNotMatch(
      response.body,
      /from ["']@module-federation\/runtime["']/,
      "the SSR remote entry still contains a bare runtime import",
    );
    assert.doesNotMatch(
      remote.output,
      /Failed to load url @module-federation\/runtime/,
      "Nuxt reported an unresolved shared runtime import",
    );
  },
);
