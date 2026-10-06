import { createBridgeComponent } from "@module-federation/bridge-vue3";
import App from "./bridge/App.vue";
import { createBridgeRouter } from "./bridge/router";

/**
 * Application-level Bridge export for hosts (Nuxt, Vue, React, …).
 * Component federation (./Widget, ./Counter) is unchanged.
 */
export default createBridgeComponent({
  rootComponent: App,
  appOptions: () => ({
    router: createBridgeRouter(),
  }),
});
