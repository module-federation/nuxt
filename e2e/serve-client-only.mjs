import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createNuxtFixture,
  nuxtCliPath,
  runCommand,
  serverEnv,
  startNitro,
  stopProcess,
  waitForResponse,
} from "../test/helpers/release.mjs";

const remotePort = 4182;
const hostPort = 4181;
const remoteEntry = `http://127.0.0.1:${remotePort}/mf-manifest.json`;

let remoteRoot;
let hostRoot;
let remoteServer;
let hostServer;
let stopping = false;

function build(app, root) {
  return runCommand(process.execPath, [nuxtCliPath(app), "build", root], {
    cwd: root,
    env: serverEnv(),
  });
}

async function cleanup() {
  if (stopping) return;
  stopping = true;
  await Promise.all(
    [hostServer, remoteServer].filter(Boolean).map(stopProcess),
  );
  await Promise.all([
    remoteRoot && rm(remoteRoot, { recursive: true, force: true }),
    hostRoot && rm(hostRoot, { recursive: true, force: true }),
  ]);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await cleanup();
    process.exit(0);
  });
}

try {
  remoteRoot = await createNuxtFixture("remote", {
    ssr: false,
    devServer: { port: remotePort },
    moduleFederation: {
      ssr: false,
      config: { name: "remote" },
    },
  });
  hostRoot = await createNuxtFixture("host", {
    ssr: false,
    devServer: { port: hostPort },
    moduleFederation: {
      ssr: false,
      config: {
        name: "host",
        hostInitInjectLocation: "entry",
        remotes: {
          remote: {
            type: "module",
            name: "remote",
            entry: remoteEntry,
          },
        },
      },
    },
  });

  await writeFile(
    resolve(remoteRoot, "app/components/exposed/Widget.vue"),
    '<template><h1 data-testid="remote-widget">dashboard</h1></template>\n',
  );
  await mkdir(resolve(hostRoot, "app/pages"), { recursive: true });
  await writeFile(
    resolve(hostRoot, "app/app.vue"),
    "<template><NuxtPage /></template>\n",
  );
  await writeFile(
    resolve(hostRoot, "app/pages/index.vue"),
    '<template><NuxtLink to="/dashboard">Dashboard</NuxtLink></template>\n',
  );
  await writeFile(
    resolve(hostRoot, "app/pages/dashboard.vue"),
    "<template><RemoteWidget /></template>\n",
  );

  await build("remote", remoteRoot);
  remoteServer = startNitro(remoteRoot, remotePort, remoteRoot);
  await waitForResponse(
    remoteEntry,
    remoteServer,
    ({ status }) => status === 200,
  );

  await build("host", hostRoot);
  hostServer = startNitro(hostRoot, hostPort, hostRoot);
  await waitForResponse(`http://127.0.0.1:${hostPort}/`, hostServer);
} catch (error) {
  await cleanup();
  throw error;
}

await new Promise(() => {});
