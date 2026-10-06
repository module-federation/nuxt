interface RemoteOptions {
  name: string;
  type: string;
  entryGlobalName: string;
}

interface RuntimeRemote {
  alias?: string;
  name: string;
  type?: string;
  entryGlobalName?: string;
}

// Rspack records name@entry externals as script remotes. Restore the common
// Nuxt configuration so direct ESM entries work without requiring a manifest.
export default function rspackRemotes(options: Record<string, RemoteOptions>) {
  return {
    name: "nuxt-rspack-remote-options",
    beforeInit<T extends { userOptions: { remotes?: RuntimeRemote[] } }>(
      args: T,
    ): T {
      for (const remote of args.userOptions.remotes || []) {
        const configured =
          options[remote.alias || remote.name] ||
          Object.values(options).find(({ name }) => name === remote.name);
        if (configured) {
          remote.type = configured.type;
          remote.entryGlobalName = configured.entryGlobalName;
        }
      }
      return args;
    },
  };
}
