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
import { resolveSharedConfig, warnOnSharedVersionMismatches } from "./shared";
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
    const { components: remoteComponents, remoteShared } =
      await resolveRemoteComponents({
        configured: options.remoteComponents,
        manifestFetchTimeoutMs: options.manifestFetchTimeoutMs,
        remotes: config.remotes,
      });
    const renderRemoteComponents =
      Boolean(nuxt.options.ssr) && options.ssr !== false;

    warnOnSharedVersionMismatches(nuxt, config.shared, remoteShared);
    registerRemoteEntryRoutes(nuxt, publicBase, options);
    registerRemoteComponents(remoteComponents, {
      hostName: config.name || "remote",
      server: renderRemoteComponents,
    });
    registerRemoteEntryAssetCopy(nuxt, publicBase, options);
    await registerFederationPlugin(
      { ...options, config },
      exposed,
      nuxt.options.rootDir,
      { remoteSsr: renderRemoteComponents },
    );
    registerCorsPlugin();
  },
});

export default module;
