export default function preserveViteRuntimeImports(source: string) {
  return source.replaceAll("/* @vite-ignore */", "/* webpackIgnore: true */");
}
