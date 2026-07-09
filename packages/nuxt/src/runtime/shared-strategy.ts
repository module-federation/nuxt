// Module Federation runtime plugin forcing every shared dependency to the
// "loaded-first" strategy, so an already-initialized shared module (e.g. the
// host's Vue instance) is reused instead of re-negotiated per remote. Mirrors
// @module-federation/modern-js's shared-strategy runtime plugin. Kept
// dependency-free (structural types) because it is bundled into both the
// browser and the server build.

interface SharedEntry {
  strategy?: "version-first" | "loaded-first";
}

interface SharedStrategyArgs {
  userOptions: {
    shared?: Record<string, SharedEntry | SharedEntry[]>;
  };
}

const sharedStrategy = () => ({
  name: "shared-strategy-plugin",
  beforeInit<T extends SharedStrategyArgs>(args: T): T {
    const shared = args.userOptions.shared;
    if (!shared) return args;

    for (const sharedConfig of Object.values(shared)) {
      const entries = Array.isArray(sharedConfig)
        ? sharedConfig
        : [sharedConfig];

      for (const entry of entries) {
        entry.strategy = "loaded-first";
      }
    }

    return args;
  },
});

export default sharedStrategy;
