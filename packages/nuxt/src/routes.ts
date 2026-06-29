import { type useNuxt } from "@nuxt/kit";

type Nuxt = ReturnType<typeof useNuxt>;

export function registerRemoteEntryRoutes(nuxt: Nuxt, publicBase: string) {
  nuxt.options.routeRules ||= {};
  nuxt.options.routeRules[`${publicBase}/**`] = {
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  };

  nuxt.options.nitro.devProxy ||= {};
  // TODO: derive target from remote config instead of assuming the example port.
  nuxt.options.nitro.devProxy[publicBase] = {
    target: "http://localhost:4174/_nuxt",
  };
}
