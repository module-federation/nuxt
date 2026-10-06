import type { moduleFederationPlugin } from "@module-federation/enhanced";
import type { FederationOptions } from "./options";

export function normalizeRspackRemotes(
  remotes: FederationOptions["remotes"],
): moduleFederationPlugin.RemotesObject | undefined {
  if (!remotes) return;

  return Object.fromEntries(
    Object.entries(remotes).map(([alias, remote]) => {
      if (typeof remote === "string") {
        return [
          alias,
          /^https?:\/\//.test(remote) ? `${alias}@${remote}` : remote,
        ];
      }

      return [
        alias,
        {
          external: `${remote.name || alias}@${remote.entry}`,
          ...(remote.shareScope ? { shareScope: remote.shareScope } : {}),
        },
      ];
    }),
  );
}

export function resolveRspackRemoteOptions(
  remotes: FederationOptions["remotes"],
) {
  return Object.fromEntries(
    Object.entries(remotes || {}).flatMap(([alias, remote]) =>
      typeof remote === "string"
        ? []
        : [
            [
              alias,
              {
                name: remote.name || alias,
                type: remote.type || "var",
                entryGlobalName: remote.entryGlobalName || remote.name || alias,
              },
            ],
          ],
    ),
  );
}
