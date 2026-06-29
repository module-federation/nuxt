<template>
  <main class="examples">
    <div class="host-column">
      <HostCard />
    </div>
    <div class="component-grid">
      <HostSsrComponent />
      <Suspense>
        <RemoteWidget />
        <template #fallback>
          <div>Loading remote widget...</div>
        </template>
      </Suspense>
      <Suspense>
        <RemoteCounter />
        <template #fallback>
          <div>Loading remote counter...</div>
        </template>
      </Suspense>
    </div>
  </main>
</template>

<style>
body {
  margin: 0;
  font-family: sans-serif;
}

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
