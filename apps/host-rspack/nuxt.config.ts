const hostOrigin = "http://localhost:4175";
const remoteOrigin = "http://localhost:4176";
const remoteBase = "/rspack-remote-mf";
const remoteAssets = "/rspack-remote-assets";

export default defineNuxtConfig({
  extends: ["../host"],
  builder: "rspack",
  routeRules: {
    [`${remoteBase}/**`]: {
      proxy: `${remoteOrigin}${remoteBase}/**`,
    },
    [`${remoteAssets}/**`]: {
      proxy: `${remoteOrigin}${remoteAssets}/**`,
    },
  },
  moduleFederation: {
    config: {
      name: "hostRspack",
      remotes: {
        remote: `remote@${hostOrigin}${remoteBase}/mf-manifest.json`,
      },
    },
  },
});
