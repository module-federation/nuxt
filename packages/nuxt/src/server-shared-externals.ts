import { addVitePlugin, resolvePath } from "@nuxt/kit";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isJsonObject } from "./json";

const ROUTER_INJECTION_KEYS = [
  "matchedRouteKey",
  "viewDepthKey",
  "routerKey",
  "routeLocationKey",
  "routerViewLocationKey",
] as const;
const wrappedRunnerHotChannels = new WeakSet<object>();
const moduleRoot = fileURLToPath(new URL("..", import.meta.url));

export async function registerServerSharedExternals(
  packageNames: string[],
  rootDir: string,
  dev: boolean,
  runnerPackageNames: string[] = packageNames,
) {
  if (packageNames.length === 0) return;
  const resolvedDevImports = dev
    ? new Map(
        await Promise.all(
          packageNames.map(
            async (packageName) =>
              [
                packageName,
                await resolveDevImport(packageName, rootDir),
              ] as const,
          ),
        ),
      )
    : new Map<string, string>();

  addVitePlugin(
    {
      name: "module-federation:nuxt:ssr-shared-externals",
      enforce: "pre",
      async resolveId(id) {
        const isSharedPackage = packageNames.some(
          (candidate) => id === candidate || id.startsWith(`${candidate}/`),
        );
        if (!isSharedPackage) return;

        if (dev) {
          return {
            id:
              resolvedDevImports.get(id) ||
              (await resolveDevImport(id, rootDir)),
            external: false,
          };
        }
        return { id, external: true };
      },
    },
    { client: false, prepend: true },
  );

  if (dev) {
    const runnerImports = new Map(
      [...resolvedDevImports].filter(([packageName]) =>
        runnerPackageNames.includes(packageName),
      ),
    );
    registerDevRunnerPlugin(runnerImports);
  }
  if (dev && packageNames.includes("vue-router")) {
    registerVueRouterInjectionKeyPlugin();
  }
}

function registerVueRouterInjectionKeyPlugin() {
  addVitePlugin(
    {
      name: "module-federation:nuxt:dev-vue-router-injection-keys",
      enforce: "pre",
      transform(code, id) {
        if (
          !id.includes("/vue-router/") ||
          !code.includes("//#region src/injectionSymbols.ts")
        ) {
          return;
        }

        let transformed = code;
        for (const key of ROUTER_INJECTION_KEYS) {
          const declaration = new RegExp(`const ${key} = Symbol\\([^;]+\\);`);
          transformed = transformed.replace(
            declaration,
            `const ${key} = Symbol.for(${JSON.stringify(`@module-federation/nuxt:vue-router:${key}`)});`,
          );
        }

        return transformed === code ? undefined : { code: transformed };
      },
    },
    // MF Vite falls back to the client environment for /__mf_runner__ when a
    // remote uses Nuxt's legacy Vite setup. Keep both runners on the same
    // global injection keys so a remote component can consume the host router.
    { prepend: true },
  );
}

function registerDevRunnerPlugin(resolvedImports: Map<string, string>) {
  addVitePlugin(
    {
      name: "module-federation:nuxt:dev-runner-shared-imports",
      enforce: "pre",
      configureServer(server) {
        for (const environment of Object.values(server.environments || {})) {
          const hot = environment.hot;
          if (
            !hot ||
            typeof hot.handleInvoke !== "function" ||
            wrappedRunnerHotChannels.has(hot)
          ) {
            continue;
          }

          const handleInvoke = hot.handleInvoke.bind(hot);
          hot.handleInvoke = (payload) =>
            handleInvoke(normalizeRunnerSharedFetch(payload, resolvedImports));
          wrappedRunnerHotChannels.add(hot);
        }
      },
    },
    { prepend: true },
  );
}

function normalizeRunnerSharedFetch<T>(
  payload: T,
  resolvedImports: Map<string, string>,
): T {
  if (!isJsonObject(payload) || payload.type !== "custom") return payload;
  if (payload.event !== "vite:invoke" || !isJsonObject(payload.data)) {
    return payload;
  }

  const invoke = payload.data;
  if (invoke.name !== "fetchModule" || !Array.isArray(invoke.data)) {
    return payload;
  }

  const [id, importer, ...options] = invoke.data;
  const specifier =
    typeof id === "string" ? decodeRunnerModuleId(id) : undefined;
  const resolved = specifier ? resolvedImports.get(specifier) : undefined;
  if (!resolved || typeof importer !== "string") {
    return payload;
  }

  // Vite's fetchModule cannot resolve bare packages relative to remote URLs
  // such as /components/Foo.vue. Send their app- or module-relative absolute
  // paths through Vite instead of falling back to Node package resolution.
  return {
    ...payload,
    data: {
      ...invoke,
      data: [resolved, null, ...options],
    },
  } as T;
}

function decodeRunnerModuleId(id: string) {
  return id.startsWith("/@id/")
    ? id.slice("/@id/".length).replaceAll("__x00__", "\0")
    : id;
}

async function resolveDevImport(id: string, rootDir: string) {
  const appResolved = await resolvePath(id, { cwd: rootDir });
  if (existsSync(appResolved)) return appResolved;

  return resolvePath(id, { cwd: moduleRoot });
}
