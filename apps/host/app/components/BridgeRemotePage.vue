<script setup lang="ts">
/**
 * Host catch-all for the remote Bridge app (`remote/bridge/export-app`).
 *
 * Route path uses Vue Router's `:pathMatch(.*)*` so current bridge-vue3
 * basename auto-detect works. Prefer explicit `basename: '/bridge'` once
 * module-federation/core#4984 is published.
 */
import { createRemoteAppComponent } from "@module-federation/bridge-vue3";

const RemoteBridgeApp = createRemoteAppComponent({
  loader: () => import("remote/bridge/export-app"),
  // After module-federation/core#4984, prefer: basename: '/bridge'
  asyncComponentOptions: {
    suspensible: false,
  },
});
</script>

<template>
  <ClientOnly>
    <div class="bridge-host">
      <p class="hint">
        Application-level Bridge remote (client island). Component federation on
        <NuxtLink to="/">/</NuxtLink> is unchanged.
      </p>
      <component :is="RemoteBridgeApp" />
    </div>
    <template #fallback>
      <p class="hint">Loading Bridge remote…</p>
    </template>
  </ClientOnly>
</template>

<style scoped>
.bridge-host {
  padding: 1rem;
}
.hint {
  opacity: 0.8;
  font-size: 0.9rem;
  margin-bottom: 1rem;
}
</style>
