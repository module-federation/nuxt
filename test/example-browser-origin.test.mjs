import assert from "node:assert/strict";
import test from "node:test";
import federationBrowserOrigin from "../apps/host/federation-browser-origin.ts";

test("network preview remotes use the browser hostname without changing SSR origins", () => {
  const plugin = federationBrowserOrigin();
  const createOptions = () => ({
    userOptions: {
      remotes: [
        {
          entry:
            "http://localhost:4176/rspack-remote-mf/mf-manifest.json?version=1",
          type: "var",
        },
        { entry: "http://127.0.0.1:4174/remoteEntry.js", type: "module" },
        { entry: "https://remote.example.com/mf-manifest.json" },
      ],
    },
  });
  const serverOptions = createOptions();
  plugin.beforeInit(serverOptions);
  assert.deepEqual(serverOptions, createOptions());

  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    Object.defineProperty(globalThis, "window", {
      value: { location: { hostname: "192.0.2.10" } },
      configurable: true,
    });
    const browserOptions = createOptions();
    plugin.beforeInit(browserOptions);
    assert.deepEqual(browserOptions.userOptions.remotes, [
      {
        entry:
          "http://192.0.2.10:4176/rspack-remote-mf/mf-manifest.json?version=1",
        type: "var",
      },
      { entry: "http://192.0.2.10:4174/remoteEntry.js", type: "module" },
      { entry: "https://remote.example.com/mf-manifest.json" },
    ]);
    window.location.hostname = "localhost";
    const localOptions = createOptions();
    plugin.beforeInit(localOptions);
    assert.deepEqual(localOptions, createOptions());
  } finally {
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else delete globalThis.window;
  }
});
