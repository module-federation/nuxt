<template>
  <div class="shell">
    <header>
      <strong>Nuxt MF host</strong>
      <nav>
        <NuxtLink to="/">Components</NuxtLink>
        <NuxtLink to="/bridge">Bridge app</NuxtLink>
        <NuxtLink to="/bridge/detail">Bridge detail</NuxtLink>
      </nav>
    </header>
    <NuxtPage />
  </div>
</template>

<style>
body {
  margin: 0;
  font-family: sans-serif;
}
.shell header {
  display: flex;
  gap: 1.25rem;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #e2e8f0;
}
.shell nav {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.shell a {
  color: #2563eb;
  text-decoration: none;
}
.shell a.router-link-active {
  font-weight: 600;
}
</style>
