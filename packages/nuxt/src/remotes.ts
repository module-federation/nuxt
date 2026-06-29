import type { ModuleFederationOptions } from "@module-federation/vite";
import {
  addComponent,
  addTemplate,
  addTypeTemplate,
  addVitePlugin,
} from "@nuxt/kit";
import { isJsonObject, parseJsonObject, readString } from "./json";
import { DEFAULT_MANIFEST_FETCH_TIMEOUT_MS } from "./options";

const SERVER_REMOTE_PREFIX = "\0module-federation:nuxt:ssr-remote:";
type RemoteConfig = NonNullable<ModuleFederationOptions["remotes"]>[string];

export interface RemoteComponent {
  componentName: string;
  exposedName: string;
  exportName: string;
  importPath: string;
  remoteName: string;
}

export async function resolveRemoteComponents(options: {
  configured?: Record<string, string[]>;
  manifestFetchTimeoutMs?: number;
  remotes?: ModuleFederationOptions["remotes"];
}) {
  const remoteNames = Object.keys(options.remotes || {});
  if (remoteNames.length === 0) return [];

  const components = await Promise.all(
    remoteNames.map(async (remoteName) => {
      const manifestComponents = await fetchRemoteManifestComponents(
        options.remotes?.[remoteName],
        options.manifestFetchTimeoutMs,
      );
      const exposedNames =
        manifestComponents.length > 0
          ? manifestComponents
          : options.configured?.[remoteName] || [];

      return exposedNames.map((exposedName) =>
        createRemoteComponent(remoteName, exposedName, remoteNames.length),
      );
    }),
  );

  return components.flat();
}

export function registerRemoteComponents(
  components: RemoteComponent[],
  remoteNames = [
    ...new Set(components.map((component) => component.remoteName)),
  ],
) {
  if (components.length > 0) {
    addTemplate({
      filename: "remote-components.mjs",
      async getContents() {
        return `
        import { defineAsyncComponent } from "vue";

        ${components
          .map(
            (component) => `
            export const ${component.exportName} = defineAsyncComponent({
              loader: () => import("${component.importPath}").then((m) => m.default || m),
              suspensible: true,
            });
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
                declare module "${component.importPath}" {
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

  registerServerRemoteStubs(remoteNames);
}

function createRemoteComponent(
  remoteName: string,
  exposedName: string,
  remoteCount: number,
): RemoteComponent {
  const componentSuffix = toPascalCase(exposedName);
  const componentName =
    remoteCount === 1
      ? `Remote${componentSuffix}`
      : `Remote${toPascalCase(remoteName)}${componentSuffix}`;

  return {
    componentName,
    exposedName,
    exportName: `${toIdentifier(remoteName)}_${componentSuffix}`,
    importPath: `${remoteName}/${exposedName}`,
    remoteName,
  };
}

async function fetchRemoteManifestComponents(
  remote: RemoteConfig | undefined,
  timeoutMs = DEFAULT_MANIFEST_FETCH_TIMEOUT_MS,
) {
  const manifestUrl = resolveManifestUrl(remote);
  if (!manifestUrl) return [];

  try {
    const response = await fetchWithTimeout(manifestUrl, timeoutMs);
    if (!response.ok) return [];

    const manifestText = await response.text();
    const manifest = parseJsonObject(manifestText);
    if (!manifest) return [];

    return readManifestExposes(manifest)
      .map((expose) => normalizeExposeName(expose))
      .filter(isValidComponentExpose);
  } catch {
    return [];
  }
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

function readManifestExposes(manifest: Record<string, unknown>) {
  const exposes = manifest.exposes;
  if (!Array.isArray(exposes)) return [];

  return exposes.flatMap((expose) => {
    if (!isJsonObject(expose)) return [];

    const name = readString(expose, "name") || readString(expose, "path");
    return name ? [name] : [];
  });
}

function toIdentifier(value: string) {
  const identifier = toPascalCase(value);
  return identifier.charAt(0).toLowerCase() + identifier.slice(1);
}

function toPascalCase(value: string) {
  return value
    .replace(/^\.\//, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function registerServerRemoteStubs(remoteNames: string[]) {
  if (remoteNames.length === 0) return;

  addVitePlugin(
    {
      name: "module-federation:nuxt:ssr-remotes",
      enforce: "pre",
      resolveId(id) {
        if (
          remoteNames.some((name) => id === name || id.startsWith(`${name}/`))
        ) {
          return SERVER_REMOTE_PREFIX + id;
        }
      },
      load(id) {
        if (!id.startsWith(SERVER_REMOTE_PREFIX)) return;

        return `
          import { defineComponent } from "vue";

          export default defineComponent({
            name: "ModuleFederationRemoteStub",
            setup() {
              return () => null;
            },
          });
        `;
      },
    },
    { client: false },
  );
}
