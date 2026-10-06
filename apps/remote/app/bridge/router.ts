import { createRouter, createWebHistory } from "vue-router";
import Home from "./pages/Home.vue";
import Detail from "./pages/Detail.vue";

/**
 * Standalone vue-router for the Bridge export.
 * Mounted under the host basename (e.g. /bridge) by createBridgeComponent.
 */
export function createBridgeRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", name: "bridge-home", component: Home },
      { path: "/detail", name: "bridge-detail", component: Detail },
    ],
  });
}
