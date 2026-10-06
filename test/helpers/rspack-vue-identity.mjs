import assert from "node:assert/strict";
import * as vue from "vue";
import * as renderer from "vue/server-renderer";
import * as directRenderer from "@vue/server-renderer";

const setterKeys = ["__VUE_INSTANCE_SETTERS__", "__VUE_SSR_SETTERS__"];
const baseline = Object.fromEntries(
  setterKeys.map((key) => {
    assert.equal(
      globalThis[key]?.length,
      1,
      `${key} must start with exactly one host Vue runtime`,
    );
    return [key, globalThis[key].length];
  }),
);
function assertSingleRuntime(stage) {
  for (const key of setterKeys) {
    assert.equal(
      globalThis[key].length,
      baseline[key],
      `${stage} registered a second Vue runtime (${key})`,
    );
  }
}

const container = await import("./public/rspack-remote-mf/remoteEntry.ssr.js");
assert.equal(typeof container.init, "function");
assert.equal(typeof container.get, "function");
assertSingleRuntime("Importing the remote container");
await container.init(
  Object.fromEntries(
    [
      ["vue", vue],
      ["vue/server-renderer", renderer],
      ["@vue/server-renderer", directRenderer],
    ].map(([name, module]) => [
      name,
      {
        [vue.version]: {
          get: () => () => module,
          from: "vue-identity-host",
          loaded: 1,
          eager: true,
        },
      },
    ]),
  ),
);
assertSingleRuntime("Initializing the remote container");

const Counter = (await container.get("./Counter"))().default;
assertSingleRuntime("Executing the Counter expose factory");
const Widget = (await container.get("./Widget"))().default;
assertSingleRuntime("Executing the Widget expose factory");

const contexts = [{ request: "first" }, { request: "second" }];
const html = await Promise.all(
  contexts.map(async (context) => {
    const app = vue.createSSRApp({
      async setup() {
        const requestContext = vue.useSSRContext();
        assert.equal(requestContext, context);
        // Yield once so the two requests overlap while rendering the same
        // cached remote modules with separate per-request SSR state.
        await Promise.resolve();
        return () =>
          vue.h("main", { "data-request": requestContext.request }, [
            vue.h(Counter),
            vue.h(Widget),
          ]);
      },
    });
    return renderer.renderToString(app, context);
  }),
);
for (let index = 0; index < html.length; index++) {
  assert.match(html[index], /Rendered by remote before client hydration\./);
  assert.match(html[index], /I(?:'|&#39;)m the remote app/);
  assert.match(
    html[index],
    new RegExp(`data-request="${contexts[index].request}"`),
  );
  assert.doesNotMatch(html[index], /Remote counter:/);
}
assertSingleRuntime("Rendering remote components for overlapping requests");
console.log("Host and remote share one Vue runtime");
