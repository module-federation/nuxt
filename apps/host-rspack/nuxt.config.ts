const remoteOrigin = "http://localhost:4176";
const remoteBase = "/rspack-remote-mf";

export default defineNuxtConfig({
  extends: ["../host"],
  builder: "rspack",
  srcDir: "../host/app",
  moduleFederation: {
    config: {
      name: "hostRspack",
      remotes: {
        remote: {
          type: "var",
          name: "remote",
          entry: `${remoteOrigin}${remoteBase}/mf-manifest.json`,
          entryGlobalName: "remote",
          shareScope: "default",
        },
      },
    },
  },
});
