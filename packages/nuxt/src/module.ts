import { defineNuxtModule, useLogger, useNuxt } from "@nuxt/kit";
import type { Nuxt, NuxtModule } from "@nuxt/schema";
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
import { readNuxtViteBuilderVersion } from "./vite-version";

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
      Boolean(nuxt.options.ssr) &&
      options.ssr !== false &&
      (!nuxt.options.dev || supportsDevServerFederation(nuxt));

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

// The @module-federation/vite ssrEntryLoader loads remote SSR entries in dev
// through Vite's ModuleRunner and the remote's /__mf_runner__ endpoint, which
// require Vite 8+. On older Vite versions the runner protocol mismatch makes
// the SSR render hang, so fall back to client-only remote components in dev.
function supportsDevServerFederation(nuxt: Nuxt) {
  const viteVersion = readNuxtViteBuilderVersion(nuxt.options.rootDir);
  const viteMajor = Number(viteVersion?.split(".")[0]);
  if (Number.isFinite(viteMajor) && viteMajor >= 8) return true;

  useLogger("module-federation").info(
    `Server-side rendering of remote components in dev requires Vite 8+` +
      `${viteVersion ? ` (found ${viteVersion})` : ""}; ` +
      `remote components will render client-only in dev. ` +
      `Production builds still render them on the server.`,
  );

  return false;
}

export default module;
