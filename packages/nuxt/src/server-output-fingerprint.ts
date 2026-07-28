import { createHash } from "node:crypto";

interface OutputAsset {
  source: string | Uint8Array;
  type: "asset";
}

interface OutputChunk {
  code: string;
  type: "chunk";
}

type OutputBundle = Record<string, OutputAsset | OutputChunk>;

export function createSsrOutputFingerprint(
  bundle: OutputBundle,
  outputFiles: Set<string>,
  outputChunks: Set<string>,
) {
  const hash = createHash("sha256");

  for (const fileName of [...outputFiles].sort()) {
    const output = bundle[fileName];
    if (!output) continue;

    const source = outputChunks.has(fileName)
      ? stripSourceMapReference((output as OutputChunk).code)
      : (output as OutputAsset).source;
    hash.update(fileName);
    hash.update("\0");
    hash.update(source);
    hash.update("\0");
  }

  return `sha256-${hash.digest("hex")}`;
}

export function stripSourceMapReference(source: string) {
  return source.replace(
    /(?:\r?\n)?(?:\/\/[#@]\s*sourceMappingURL=[^\r\n]*|\/\*[#@]\s*sourceMappingURL=[\s\S]*?\*\/)\s*$/,
    "\n",
  );
}
