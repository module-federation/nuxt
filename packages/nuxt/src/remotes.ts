import type { ModuleFederationOptions } from "@module-federation/vite";
import { addComponent, addTemplate, addTypeTemplate } from "@nuxt/kit";
import { isJsonObject, parseJsonObject, readString } from "./json";
import { DEFAULT_MANIFEST_FETCH_TIMEOUT_MS } from "./options";
import {
  assertUniqueRemoteComponents,
  createRemoteComponent,
  createRemoteRefProxy,
  type RemoteComponent,
} from "./remote-component-utils";

export type { RemoteComponent } from "./remote-component-utils";

type RemoteConfig = NonNullable<ModuleFederationOptions["remotes"]>[string];

export interface RemoteSharedInfo {
  name: string;
  version?: string;
  requiredVersion?: string;
}

export async function resolveRemoteComponents(options: {
  configured?: Record<string, string[]>;
  manifestFetchTimeoutMs?: number;
  remotes?: ModuleFederationOptions["remotes"];
}) {
  const remoteNames = Object.keys(options.remotes || {});
  const remoteShared: Record<string, RemoteSharedInfo[]> = {};
  if (remoteNames.length === 0) return { components: [], remoteShared };

  const components = await Promise.all(
    remoteNames.map(async (remoteName) => {
      const manifest = await fetchRemoteManifest(
        options.remotes?.[remoteName],
        options.manifestFetchTimeoutMs,
      );
      remoteShared[remoteName] = manifest ? readManifestShared(manifest) : [];
      const manifestComponents = manifest
        ? readManifestExposes(manifest)
            .map((expose) => normalizeExposeName(expose))
            .filter(isValidComponentExpose)
        : [];
      const configuredComponents = normalizeComponentExposes(
        options.configured?.[remoteName] || [],
      );
      const exposedNames = [
        ...new Set([...configuredComponents, ...manifestComponents]),
      ];

      return exposedNames.map((exposedName) =>
        createRemoteComponent(remoteName, exposedName, remoteNames.length),
      );
    }),
  );
  const resolvedComponents = components.flat();
  assertUniqueRemoteComponents(resolvedComponents);

  return { components: resolvedComponents, remoteShared };
}

export function registerRemoteComponents(
  components: RemoteComponent[],
  options: { hostName?: string; server?: boolean } = {},
) {
  if (components.length > 0) {
    const renderOnServer = options.server !== false;
    const hostName = options.hostName || "remote";

    addTemplate({
      filename: "remote-components.mjs",
      async getContents() {
        return `
        import { defineAsyncComponent, defineComponent, h, onMounted, ref, shallowRef } from "vue";

        const createRemoteRefProxy = ${createRemoteRefProxy.toString()};

        const createRemoteRef = (expose) => {
          const inner = shallowRef();
          const target = {};

          // This wrapper owns the parent template ref. Expose a facade that
          // follows Vue's async-component ref to the resolved remote instance.
          expose(createRemoteRefProxy(target, () => inner.value));

          return inner;
        };

        const createClientOnlyRemote = (name, component) => defineComponent({
          name,
          setup(_, { attrs, expose, slots }) {
            const mounted = ref(false);
            const remoteRef = createRemoteRef(expose);
            onMounted(() => {
              mounted.value = true;
            });

            return () => mounted.value
              ? h(component, { ...attrs, ref: remoteRef }, slots)
              : null;
          },
        });

        const ssrRuntimeKey = Symbol.for("@module-federation/nuxt:ssr-runtime");
        const getSsrRuntime = (hostName) =>
          globalThis[ssrRuntimeKey]?.get(hostName);

        const normalizeRemote = (loaded, importPath) => {
          const component = loaded?.default || loaded;
          if (component) return component;

          throw new Error(
            "[module-federation] Remote " + importPath + " did not export a component.",
          );
        };

        const loadSsrRemote = async (hostName, remoteName, importPath, bootstrap) => {
          let runtime = getSsrRuntime(hostName);
          try {
            let loaded;
            if (runtime) {
              loaded = await runtime.load(remoteName, importPath);
            } else {
              loaded = await bootstrap();
              runtime = getSsrRuntime(hostName);
              const component = normalizeRemote(loaded, importPath);
              runtime?.markLoaded?.(remoteName);
              return component;
            }
            return normalizeRemote(loaded, importPath);
          } catch (error) {
            try {
              (runtime || getSsrRuntime(hostName))?.invalidate(remoteName);
            } catch {
              // Preserve the original remote loading error.
            }
            throw error;
          }
        };

        const createSsrRemote = (name, hostName, remoteName, importPath, bootstrap) => {
          const clientComponent = defineAsyncComponent({
            loader: () => bootstrap().then((loaded) => normalizeRemote(loaded, importPath)),
            suspensible: true,
          });

          return defineComponent({
            name,
            setup(_, { attrs, expose, slots }) {
              const remoteRef = createRemoteRef(expose);
              if (typeof window !== "undefined") {
                return () => h(clientComponent, { ...attrs, ref: remoteRef }, slots);
              }

              return loadSsrRemote(hostName, remoteName, importPath, bootstrap)
                .then((component) => () =>
                  h(component, { ...attrs, ref: remoteRef }, slots))
                .catch((error) => {
                  console.warn(
                    "[module-federation] Failed to load " + importPath + " during SSR;" +
                    " rendering nothing on the server. The client will render it after hydration.",
                    error,
                  );
                  return () => null;
                });
            },
          });
        };

        ${components
          .map((component) =>
            renderOnServer
              ? `
                  export const ${component.exportName} = createSsrRemote(
                    "${component.componentName}",
                    ${JSON.stringify(hostName)},
                    ${JSON.stringify(component.remoteName)},
                    ${JSON.stringify(component.importPath)},
                    () => import(${JSON.stringify(component.importPath)}),
                  );
                `
              : `
                  const ${component.exportName}Client = defineAsyncComponent({
                    loader: () => import(${JSON.stringify(component.importPath)}).then((m) => m.default || m),
                    suspensible: false,
                  });

                  export const ${component.exportName} = createClientOnlyRemote(
                    "${component.componentName}",
                    ${component.exportName}Client,
                  );
                `,
          )
          .join("\n")}
      `;
      },
    });

    for (const component of components) {
      addComponent({
        filePath: "#build/remote-components.mjs",
        name: component.componentName,
        export: component.exportName,
        mode: renderOnServer ? "all" : "client",
      });
    }

    addTypeTemplate({
      filename: "types/module-federation-components.d.ts",
      getContents() {
        return `
          import type { Component } from "vue";

          ${components
            .map(
              (component) => `
                declare module ${JSON.stringify(component.importPath)} {
                  const component: Component;
                  export default component;
                }
              `,
            )
            .join("\n")}

          declare module "vue" {
            export interface GlobalComponents {
              ${components
                .map((component) => `${component.componentName}: Component;`)
                .join("\n")}
            }
          }

          export {};
        `;
      },
    });
  }
}

async function fetchRemoteManifest(
  remote: RemoteConfig | undefined,
  timeoutMs = DEFAULT_MANIFEST_FETCH_TIMEOUT_MS,
) {
  const manifestUrl = resolveManifestUrl(remote);
  if (!manifestUrl) return;

  try {
    const response = await fetchWithTimeout(manifestUrl, timeoutMs);
    if (!response.ok) return;

    return parseJsonObject(await response.text()) || undefined;
  } catch {
    return;
  }
}

function readManifestShared(
  manifest: Record<string, unknown>,
): RemoteSharedInfo[] {
  const shared = manifest.shared;
  if (!Array.isArray(shared)) return [];

  return shared.flatMap((entry) => {
    if (!isJsonObject(entry)) return [];

    const name = readString(entry, "name");
    if (!name) return [];

    return [
      {
        name,
        version: readString(entry, "version"),
        requiredVersion: readString(entry, "requiredVersion"),
      },
    ];
  });
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function resolveManifestUrl(remote: RemoteConfig | undefined) {
  const entry = resolveRemoteEntry(remote);
  if (!entry) return;

  try {
    const url = new URL(entry);
    if (!url.pathname.endsWith(".json")) {
      url.pathname = url.pathname.replace(/[^/]*$/, "mf-manifest.json");
    }
    return url.toString();
  } catch {
    return;
  }
}

function resolveRemoteEntry(remote: RemoteConfig | undefined) {
  if (!remote) return;
  if (typeof remote !== "string") return remote.entry;
  if (isUrl(remote)) return remote;

  for (const atIndex of findDelimiterIndexes(remote, "@")) {
    const entry = remote.slice(atIndex + 1);
    if (isUrl(entry)) return entry;
  }

  return remote;
}

function isUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function findDelimiterIndexes(value: string, delimiter: string) {
  const indexes: number[] = [];
  let index = value.indexOf(delimiter);

  while (index !== -1) {
    indexes.push(index);
    index = value.indexOf(delimiter, index + delimiter.length);
  }

  return indexes;
}

function normalizeExposeName(value: string | undefined) {
  return value?.replace(/^\.\//, "");
}

function isValidComponentExpose(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z][\w-]*$/.test(value));
}

function normalizeComponentExposes(exposes: string[]) {
  return exposes
    .map((expose) => normalizeExposeName(expose))
    .filter(isValidComponentExpose);
}

function readManifestExposes(manifest: Record<string, unknown>) {
  const exposes = manifest.exposes;
  if (!Array.isArray(exposes)) return [];

  return exposes.flatMap((expose) => {
    if (!isJsonObject(expose)) return [];

    const name = readString(expose, "name") || readString(expose, "path");
    return name ? [name] : [];
  });
}
