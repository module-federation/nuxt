interface RuntimeRemote {
  entry?: string;
}

const isLoopback = (hostname: string) =>
  hostname === "localhost" ||
  hostname === "[::1]" ||
  /^127(?:\.\d{1,3}){3}$/.test(hostname);

// Keep server-side federation on loopback while allowing the built examples
// to be opened from another computer using this machine's network hostname.
export default function federationBrowserOrigin() {
  return {
    name: "example-browser-remote-origin",
    beforeInit<T extends { userOptions: { remotes?: RuntimeRemote[] } }>(
      args: T,
    ): T {
      if (typeof window === "undefined") return args;
      const hostname = window.location.hostname;
      if (!hostname || isLoopback(hostname)) return args;

      for (const remote of args.userOptions.remotes || []) {
        if (!remote.entry) continue;
        let entry: URL;
        try {
          entry = new URL(remote.entry);
        } catch {
          continue;
        }
        if (
          !["http:", "https:"].includes(entry.protocol) ||
          !isLoopback(entry.hostname)
        ) {
          continue;
        }
        entry.hostname = hostname;
        remote.entry = entry.href;
      }

      return args;
    },
  };
}
