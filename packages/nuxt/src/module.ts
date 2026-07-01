import { defineNuxtModule, useNuxt } from "@nuxt/kit";
import type { NuxtModule } from "@nuxt/schema";
import { registerExposedComponents, resolveExposedDir } from "./exposes";
import {
  defaultModuleOptions,
  normalizeBase,
  type ModuleOptions,
} from "./options";
import { registerRemoteEntryAssetCopy } from "./public-assets";
import { registerRemoteComponents, resolveRemoteComponents } from "./remotes";
import { registerRemoteEntryRoutes } from "./routes";
import { resolveSharedConfig } from "./shared";
import { registerCorsPlugin, registerFederationPlugin } from "./vite";

const module: NuxtModule<ModuleOptions> = defineNuxtModule<ModuleOptions>({
  meta: {
    name: "@module-federation/nuxt",
    configKey: "moduleFederation",
  },
  defaults: defaultModuleOptions,
  async setup(options) {
    const nuxt = useNuxt();
    const publicBase = normalizeBase(options.base);
    const exposedDir = resolveExposedDir(nuxt, options.exposedDir);
    const exposed = registerExposedComponents(nuxt, exposedDir);
    const config = {
      ...options.config,
      shared: resolveSharedConfig(nuxt, options.config?.shared),
    };
    const remoteComponents = await resolveRemoteComponents({
      configured: options.remoteComponents,
      manifestFetchTimeoutMs: options.manifestFetchTimeoutMs,
      remotes: config.remotes,
    });

    registerRemoteEntryRoutes(nuxt, publicBase);
    registerRemoteComponents(remoteComponents, { server: !nuxt.options.dev });
    registerRemoteEntryAssetCopy(nuxt, publicBase);
    registerFederationPlugin(
      { ...options, config },
      exposed,
      nuxt.options.rootDir,
      { server: !nuxt.options.dev },
    );
    registerCorsPlugin();
  },
});

export default module;
