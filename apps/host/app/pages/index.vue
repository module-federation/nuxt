<script setup lang="ts">
import HostCard from "../components/HostCard.vue";
import HostSsrComponent from "../components/HostSsrComponent.vue";

const message = "Hello World";
</script>

<template>
  <main class="examples">
    <div class="host-column">
      <HostCard />
    </div>
    <div class="component-grid">
      <HostSsrComponent />
      <Suspense>
        <RemoteWidget :message />
        <template #fallback>
          <div>Loading remote widget...</div>
        </template>
      </Suspense>
      <Suspense>
        <RemoteCounter>
          <template #footer> Slot from host </template>
        </RemoteCounter>
        <template #fallback>
          <div>Loading remote counter...</div>
        </template>
      </Suspense>
    </div>
  </main>
</template>

<style scoped>
.examples {
  display: block;
}
.host-column {
  float: left;
}
.component-grid {
  display: flex;
  flex-wrap: wrap;
}
</style>
