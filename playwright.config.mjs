import { defineConfig, devices } from "@playwright/test";

const mode = process.env.E2E_MODE ?? "production";
if (mode !== "production" && mode !== "dev") {
  throw new Error(`Unsupported E2E_MODE: ${mode}. Use production or dev.`);
}

const apps = [
  { name: "nuxt-remote", port: 4174, ready: "/remoteEntry.js" },
  { name: "nuxt-host", port: 4173, ready: "/" },
  {
    name: "nuxt-remote-rspack",
    port: 4176,
    ready: "/rspack-remote-mf/mf-manifest.json",
  },
  { name: "nuxt-host-rspack", port: 4175, ready: "/" },
];

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/nuxt.spec.mjs",
  outputDir: `reports/e2e/${mode}/output`,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["list"],
    ["html", { outputFolder: `reports/e2e/${mode}/html`, open: "never" }],
  ],
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "vite",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:4173",
      },
    },
    {
      name: "rspack",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:4175",
      },
    },
    {
      name: "vite-host-rspack-remote",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:4177",
      },
    },
    {
      name: "rspack-host-vite-remote",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:4178",
      },
    },
    ...(mode === "dev"
      ? [
          {
            name: "rspack-hmr",
            testMatch: "**/hmr.spec.mjs",
            dependencies: [
              "vite",
              "rspack",
              "vite-host-rspack-remote",
              "rspack-host-vite-remote",
            ],
            use: {
              ...devices["Desktop Chrome"],
              baseURL: "http://localhost:4177",
            },
          },
        ]
      : []),
  ],
  webServer: [
    ...apps.map(({ name, port, ready }) => ({
      command:
        mode === "dev" && name === "nuxt-remote-rspack"
          ? "node e2e/serve-fixture.mjs remote-rspack dev"
          : `pnpm --filter ${name} ${mode === "dev" ? "dev" : "preview"}`,
      url: `http://localhost:${port}${ready}`,
      // An unrelated process or stale build must never satisfy this suite.
      reuseExistingServer: false,
      timeout: 180_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    })),
    ...["vite", "rspack"].map((builder, index) => ({
      command: `node e2e/serve-fixture.mjs ${builder} ${mode}`,
      url: `http://localhost:${4177 + index}`,
      reuseExistingServer: false,
      timeout: 180_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    })),
  ],
});
