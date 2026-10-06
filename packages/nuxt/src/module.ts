import { defineNuxtModule, useNuxt } from "@nuxt/kit";
import type { NuxtModule } from "@nuxt/schema";
import { registerDtsTemplates } from "./dts";
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
import { usesNativeServerVue } from "./rspack-server-vue";

const module: NuxtModule<ModuleOptions> = defineNuxtModule<ModuleOptions>({
  meta: {
    name: "@module-federation/nuxt",
    configKey: "moduleFederation",
  },
  defaults: defaultModuleOptions,
  async setup(options) {
    const nuxt = useNuxt();
    const builder = resolveFederationBuilder(nuxt.options.builder);
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
        discoverManifest: options.config?.manifest !== false,
      });
    const renderRemoteComponents =
      Boolean(nuxt.options.ssr) && options.ssr !== false;

    if (builder === "vite") {
      warnOnSharedVersionMismatches(nuxt, config.shared, remoteShared);
    } else if (usesNativeServerVue(config.shared)) {
      warnOnSharedVersionMismatches(nuxt, ["vue"], remoteShared);
    }
    registerRemoteEntryRoutes(nuxt, publicBase, options);
    registerRemoteComponents(remoteComponents, {
      hostName: config.name || "remote",
      server: renderRemoteComponents,
    });
    if (builder === "vite") {
      registerDtsTemplates(
        nuxt,
        config.dts,
        Object.keys(config.remotes || {}),
        exposed,
      );
    }
    registerRemoteEntryAssetCopy(nuxt, publicBase, options);
    if (builder === "rspack") {
      const { registerRspackFederationPlugin } = await import("./rspack");
      await registerRspackFederationPlugin(
        { ...options, config },
        exposed,
        nuxt.options.rootDir,
        { remoteSsr: renderRemoteComponents },
      );
    } else {
      await registerFederationPlugin(
        { ...options, config },
        exposed,
        nuxt.options.rootDir,
        { remoteSsr: renderRemoteComponents },
      );
      registerCorsPlugin();
    }
  },
});

export default module;

export function resolveFederationBuilder(builder: unknown) {
  if (builder === "rspack" || builder === "@nuxt/rspack-builder") {
    return "rspack";
  }
  if (
    builder === undefined ||
    builder === "vite" ||
    builder === "@nuxt/vite-builder"
  ) {
    return "vite";
  }

  throw new Error(
    `[module-federation] Unsupported Nuxt builder ${typeof builder === "string" ? JSON.stringify(builder) : "(custom builder)"}. Use "vite" or "rspack".`,
  );
}
