const MODULE_IMPORT_RE =
  /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(["'`])([^"'`]+)\1/g;

interface OutputFileSource {
  code?: string;
  type: string;
}

export function findModuleSpecifiers(source: string) {
  return [...source.matchAll(MODULE_IMPORT_RE)]
    .map((match) => match[2])
    .filter((specifier): specifier is string => Boolean(specifier));
}

export function assertPortableSsrOutputGraph(
  bundle: Record<string, OutputFileSource | undefined>,
  outputChunks: Set<string>,
) {
  for (const fileName of outputChunks) {
    const output = bundle[fileName];
    if (!output || output.type !== "chunk" || typeof output.code !== "string") {
      continue;
    }

    for (const specifier of findModuleSpecifiers(output.code)) {
      if (!isNonPortableModuleSpecifier(specifier)) continue;

      throw new Error(
        `[module-federation] Nuxt SSR output ${fileName} contains non-portable import ${JSON.stringify(specifier)}. Bundle the dependency instead of publishing a build-machine path.`,
      );
    }
  }
}

function isNonPortableModuleSpecifier(specifier: string) {
  return Boolean(
    specifier.startsWith("/") ||
    specifier.startsWith("\\\\") ||
    /^[a-zA-Z]:[\\/]/.test(specifier) ||
    /^file:/i.test(specifier),
  );
}
