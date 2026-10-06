import type { ModuleOptions } from "./options";

const VUE_PACKAGES = new Set(["vue", "@vue/server-renderer"]);
const VUE_RUNTIME_FILE =
  /^dist\/vue(?:\.runtime)?\.(?:cjs|esm-browser|esm-bundler|global)(?:\.prod)?\.js$/;
const VUE_RENDERER_FILE =
  /^dist\/server-renderer\.(?:cjs|esm-browser|esm-bundler)(?:\.prod)?\.js$/;

export function isVersionShorthand(value: string) {
  return /^(?:\d|[\^=<>~]|v(?=\d)|[*xX]$)/.test(value);
}

export function usesNativeServerVue(
  shared: NonNullable<ModuleOptions["config"]>["shared"],
) {
  if (Array.isArray(shared)) return shared.includes("vue");
  const vue = shared?.vue;
  if (!vue) return false;
  if (typeof vue === "string") {
    return vue === "vue" || isVersionShorthand(vue);
  }
  return (
    vue.singleton !== false &&
    (vue.import === undefined || vue.import === false || vue.import === "vue")
  );
}

export function resolveServerVueExternal(request: string) {
  const normalized = request.replaceAll("\\", "/");
  if (normalized === "vue/server-renderer") return "vue/server-renderer";
  if (VUE_PACKAGES.has(normalized)) return publicSpecifier(normalized);

  // Nuxt and Vue's own package exports can resolve requests before the
  // externals hook. Rebase only known runtime entries, never arbitrary files.
  const packageRequest =
    normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)
      ? normalized.match(/\/node_modules\/(vue|@vue\/[^/]+)\/(.+)$/)?.slice(1)
      : normalized.match(/^(vue|@vue\/[^/]+)\/(.+)$/)?.slice(1);
  if (!packageRequest) return;
  const [packageName, file] = packageRequest;
  if (!packageName || !file || !VUE_PACKAGES.has(packageName)) return;
  if (packageName === "vue" && /^server-renderer\/index\.[cm]?js$/.test(file)) {
    return "vue/server-renderer";
  }
  if (
    /^index\.[cm]?js$/.test(file) ||
    (packageName === "vue"
      ? VUE_RUNTIME_FILE.test(file)
      : VUE_RENDERER_FILE.test(file))
  ) {
    return publicSpecifier(packageName);
  }
}

function publicSpecifier(packageName: string) {
  return packageName === "@vue/server-renderer"
    ? "vue/server-renderer"
    : packageName;
}
