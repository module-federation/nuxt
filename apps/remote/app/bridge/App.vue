<template>
  <div class="bridge-app">
    <h2>Bridge remote app</h2>
    <nav>
      <RouterLink to="/">Home</RouterLink>
      <RouterLink to="/detail">Detail</RouterLink>
    </nav>
    <RouterView />
  </div>
</template>

<style scoped>
.bridge-app {
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 1rem;
  max-width: 28rem;
}
nav {
  display: flex;
  gap: 0.75rem;
  margin: 0.75rem 0;
}
a {
  color: #2563eb;
}
</style>
