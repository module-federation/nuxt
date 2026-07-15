<script setup lang="ts">
import { provide } from "vue";

provide("module-federation:host-context", "connected");
</script>

<template>
  <NuxtPage />
</template>
