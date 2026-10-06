const remoteOrigin = "http://localhost:4176";
const remoteBase = "/rspack-remote-mf";

export default defineNuxtConfig({
  extends: ["../host"],
  builder: "rspack",
  srcDir: "../host/app",
  moduleFederation: {
    config: {
      name: "hostRspack",
      // MF type generation is configured for the Vite examples only.
      dts: false,
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
