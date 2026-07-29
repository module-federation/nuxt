export function resolveBuildAssetUrl(
  publicBase: string,
  buildAssetsDir: string,
  requestUrl: string,
  matchedAssetPath?: string,
) {
  const [requestPath = "/", query] = requestUrl.split("?");
  const pathname = matchedAssetPath || requestPath;
  const assetPath = pathname.startsWith(publicBase)
    ? pathname.slice(publicBase.length)
    : pathname;
  const normalizedAssetPath = assetPath.replace(/^\/+/, "");
  const resolvedPath = `${buildAssetsDir}/${normalizedAssetPath}`;

  return query ? `${resolvedPath}?${query}` : resolvedPath;
}
