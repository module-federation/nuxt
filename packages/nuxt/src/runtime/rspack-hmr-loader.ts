/** Resolve a remote's HMR socket against its runtime, rather than the host page. */
export default function preserveRspackHmrOrigin(source: string) {
  const socketUrlDeclaration = /const\s+url\s*=\s*formatURL\(fallback\);/;
  if (!socketUrlDeclaration.test(source)) {
    throw new Error(
      "[module-federation] Cannot locate Rsbuild's HMR socket URL. Check the installed @nuxt/rspack-builder version.",
    );
  }

  return source.replace(
    socketUrlDeclaration,
    `let url = formatURL(fallback);
        if (!resolveWebSocketUrl) {
            const remoteLocation = new URL(__webpack_public_path__, self.location.href);
            const socketUrl = new URL(url);
            if (!config.host) socketUrl.hostname = remoteLocation.hostname;
            if (!config.port) socketUrl.port = remoteLocation.port;
            if (!config.protocol) socketUrl.protocol = remoteLocation.protocol === "https:" ? "wss:" : "ws:";
            url = socketUrl.href;
        }`,
  );
}
