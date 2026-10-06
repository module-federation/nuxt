export function patchRspackServerChunkLoading(
  source: string,
  chunkLoaders: Array<[number | string, string]>,
) {
  const marker = [
    "// webpack/runtime/get javascript chunk filename",
    "// webpack/runtime/make_namespace_object",
    "// webpack/runtime/module_federation/runtime",
  ].find((candidate) => source.includes(candidate));
  if (!marker) return source;

  if (
    source.includes("__webpack_require__.f.") &&
    !source.includes("__webpack_require__.f =")
  ) {
    const firstChunkHandler = source.indexOf("__webpack_require__.f.");
    source = `${source.slice(0, firstChunkHandler)}__webpack_require__.f = {};\n${source.slice(firstChunkHandler)}`;
  }
  const dynamicChunkImport =
    /import\(\s*["']\.\/["']\s*\+\s*__webpack_require__\.u\(chunkId\)\s*\)/g;
  if (dynamicChunkImport.test(source)) {
    source = source
      .replace(dynamicChunkImport, "__nuxtRspackChunkLoaders[chunkId]()")
      .replace(
        marker,
        `var __nuxtRspackChunkLoaders = {\n${renderRspackChunkLoaderEntries(chunkLoaders)}\n};\n${marker}`,
      );
  }
  if (source.includes("__webpack_require__.f.j =")) return source;

  return source.replace(
    marker,
    `${renderRspackServerChunkLoader(chunkLoaders)}\n${marker}`,
  );
}

function renderRspackServerChunkLoader(
  chunkLoaders: Array<[number | string, string]>,
) {
  const entries = renderRspackChunkLoaderEntries(chunkLoaders);

  return `// webpack/runtime/nuxt_module_chunk_loading
(() => {
__webpack_require__.f = __webpack_require__.f || {};
var installedChunks = {};
var chunkLoaders = {
${entries}
};
var installChunk = (data) => {
  var moduleId;
  for (moduleId in data.__webpack_modules__) {
    if (__webpack_require__.o(data.__webpack_modules__, moduleId)) {
      __webpack_require__.m[moduleId] = data.__webpack_modules__[moduleId];
    }
  }
  if (data.__rspack_esm_runtime) data.__rspack_esm_runtime(__webpack_require__);
  for (var i = 0; i < data.__rspack_esm_ids.length; i++) {
    var chunkId = data.__rspack_esm_ids[i];
    installedChunks[chunkId] = 0;
  }
};
__webpack_require__.f.j = (chunkId, promises) => {
  var installedChunk = __webpack_require__.o(installedChunks, chunkId)
    ? installedChunks[chunkId]
    : undefined;
  if (installedChunk === 0) return;
  if (installedChunk) {
    promises.push(installedChunk);
    return;
  }
  var load = chunkLoaders[chunkId];
  if (!load) return;
  var promise = load().then(installChunk, (error) => {
    installedChunks[chunkId] = undefined;
    throw error;
  });
  installedChunks[chunkId] = promise;
  promises.push(promise);
};
})();`;
}

function renderRspackChunkLoaderEntries(
  chunkLoaders: Array<[number | string, string]>,
) {
  return chunkLoaders
    .map(
      ([chunkId, fileName]) =>
        `${JSON.stringify(chunkId)}: () => import(${JSON.stringify(`./${fileName}`)})`,
    )
    .join(",\n");
}
