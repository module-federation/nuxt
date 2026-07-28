<script setup lang="ts">
const count = ref(0);
</script>

<template>
  <div class="remote-ssr-card">
    <div class="title">Remote SSR component</div>
    <p class="description">Rendered by remote before client hydration.</p>
    <button class="counter" @click="count++">
      Remote SSR counter: {{ count }}
    </button>
  </div>
</template>

<style scoped>
.remote-ssr-card {
  background: #1f2124;
  box-shadow: 0 0 20px rgba(0, 0, 0, 0.4);
  border-radius: 5px;
  color: white;
  margin: 20px;
  padding: 20px;
  text-align: center;
  width: 250px;
}

.title {
  margin-top: 10px;
  font-size: 21px;
}

.description {
  margin: 10px 0 16px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.82);
}

.counter {
  background-color: rgb(246, 179, 82);
  border: 0;
  border-radius: 4px;
  color: rgb(24, 24, 24);
  cursor: pointer;
  font-weight: 700;
  padding: 8px 16px;
}
</style>
