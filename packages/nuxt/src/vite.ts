import { federation } from "@module-federation/vite";
import { addVitePlugin } from "@nuxt/kit";
import type { ModuleOptions } from "./options";

export function registerFederationPlugin(
  options: ModuleOptions,
  exposed: Record<string, string>,
) {
  addVitePlugin(
    () =>
      federation({
        dts: false,
        name: "remote",
        filename: "remoteEntry.js",
        manifest: {
          fileName: "mf-manifest.json",
          // TODO:
          // additionalData({ stats }) {
          //   stats.metaData.custom = {
          //     owner: 'platform',
          //     commit: process.env.GIT_SHA,
          //     deployEnv: process.env.DEPLOY_ENV,
          //   };

          //   return stats;
          // },
        },
        ...options.config,
        exposes: {
          ...exposed,
          ...options.config?.exposes,
        },
      }),
    { server: false },
  );
}

export function registerCorsPlugin() {
  addVitePlugin({
    name: "module-federation:nuxt:config",
    config() {
      return {
        server: { cors: true },
      };
    },
  });
}
