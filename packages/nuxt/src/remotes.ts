import { addComponent, addTemplate, addVitePlugin } from "@nuxt/kit";

const REMOTE_COMPONENTS = ["Counter", "Widget"] as const;
const SERVER_REMOTE_PREFIX = "\0module-federation:nuxt:ssr-remote:";

export function registerRemoteComponents(remoteNames: string[]) {
  if (remoteNames.length === 0) return;

  // TODO: iterate over the remote manifest to discover components.
  addTemplate({
    filename: "remote-components.mjs",
    async getContents() {
      return `
        import { defineAsyncComponent } from "vue";

        ${REMOTE_COMPONENTS.map(
          (component) => `
            export const ${component} = defineAsyncComponent({
              loader: () => import("remote/${component}").then((m) => m.default || m),
              suspensible: true,
            });
          `,
        ).join("\n")}
      `;
    },
  });

  for (const component of REMOTE_COMPONENTS) {
    addComponent({
      filePath: "#build/remote-components.mjs",
      name: `Remote${component}`,
      export: component,
    });
  }

  // TODO: generate remote component types.
  registerServerRemoteStubs(remoteNames);
}

function registerServerRemoteStubs(remoteNames: string[]) {
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
