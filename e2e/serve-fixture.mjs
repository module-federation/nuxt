import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createNuxtFixture,
  nuxtCliPath,
  repoRoot,
} from "../test/helpers/release.mjs";

const [builder, mode] = process.argv.slice(2);
if (!["vite", "rspack", "remote-rspack"].includes(builder)) {
  throw new Error("Fixture must be vite, rspack, or remote-rspack.");
}
if (!["production", "dev"].includes(mode)) {
  throw new Error("Fixture server mode must be production or dev.");
}

const isRemote = builder === "remote-rspack";
if (isRemote && mode !== "dev") {
  throw new Error(
    "The copied Rspack remote is only needed for development HMR.",
  );
}
const app = isRemote
  ? "remote-rspack"
  : builder === "vite"
    ? "host"
    : "host-rspack";
const port = isRemote ? 4176 : builder === "vite" ? 4177 : 4178;
const fixtureFile = isRemote
  ? resolve(repoRoot, "reports/e2e/dev/rspack-remote-fixture.json")
  : undefined;
const remote =
  builder === "vite"
    ? {
        type: "var",
        name: "remote",
        entry: "http://localhost:4176/rspack-remote-mf/mf-manifest.json",
        entryGlobalName: "remote",
        shareScope: "default",
      }
    : mode === "dev"
      ? {
          type: "module",
          name: "remote",
          entry: "http://localhost:4174/remoteEntry.js",
          entryGlobalName: "remote",
          shareScope: "default",
        }
      : "remote@http://localhost:4174/mf-manifest.json";

let child;
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    child?.kill(signal);
  });
}

const fixture = await createNuxtFixture(app, {
  devtools: { enabled: false },
  moduleFederation: isRemote
    ? { exposedDir: "~/components/exposed" }
    : {
        config: {
          name: `${builder}CrossHost`,
          remotes: { remote },
        },
      },
  vite: { server: { hmr: { port: 24680 } } },
});

async function run(args) {
  if (stopping) return;

  child = spawn(process.execPath, args, {
    cwd: fixture,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: mode === "dev" ? "development" : "production",
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--dns-result-order=ipv4first"]
        .filter(Boolean)
        .join(" "),
    },
    stdio: "inherit",
  });

  const code = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  child = undefined;
  if (code !== 0 && !stopping) {
    throw new Error(`${builder} fixture exited with code ${code}`);
  }
}

try {
  if (fixtureFile) {
    await mkdir(dirname(fixtureFile), { recursive: true });
    await writeFile(fixtureFile, JSON.stringify({ root: fixture }));
  }
  if (mode === "production") {
    await run([nuxtCliPath(app), "build", fixture]);
    await run([resolve(fixture, ".output/server/index.mjs")]);
  } else {
    await run([nuxtCliPath(app), "dev", fixture, "--port", String(port)]);
  }
} finally {
  if (fixtureFile) await rm(fixtureFile, { force: true });
  await rm(fixture, { recursive: true, force: true });
}
