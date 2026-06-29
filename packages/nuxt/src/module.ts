import { defineNuxtModule, useNuxt } from "@nuxt/kit";
import { registerExposedComponents, resolveExposedDir } from "./exposes";
import {
  defaultModuleOptions,
  normalizeBase,
  type ModuleOptions,
} from "./options";
import { registerRemoteEntryAssetCopy } from "./public-assets";
import { registerRemoteComponents } from "./remotes";
import { registerRemoteEntryRoutes } from "./routes";
import { registerCorsPlugin, registerFederationPlugin } from "./vite";

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: "@module-federation/nuxt",
    configKey: "moduleFederation",
  },
  defaults: defaultModuleOptions,
  setup(options) {
    const nuxt = useNuxt();
    const publicBase = normalizeBase(options.base);
    const exposedDir = resolveExposedDir(nuxt, options.exposedDir);
    const exposed = registerExposedComponents(nuxt, exposedDir);
    const remoteNames = Object.keys(options.config?.remotes || {});

    registerRemoteEntryRoutes(nuxt, publicBase);
    registerRemoteComponents(remoteNames);
    registerRemoteEntryAssetCopy(nuxt, publicBase);
    registerFederationPlugin(options, exposed);
    registerCorsPlugin();
  },
});
