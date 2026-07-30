<script setup lang="ts">
const count = ref(0);
const hydrated = ref(false);

onMounted(() => {
  hydrated.value = true;
});
</script>

<template>
  <div
    class="remote-ssr-card"
    style="
      background: #1f2124;
      box-shadow: 0 0 20px rgba(0, 0, 0, 0.4);
      border-radius: 5px;
      color: white;
      margin: 20px;
      padding: 20px;
      text-align: center;
      width: 250px;
    "
  >
    <div style="margin-top: 10px; font-size: 21px">Remote SSR component</div>
    <p
      style="
        margin: 10px 0 16px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.82);
      "
    >
      Rendered by remote before client hydration.
    </p>
    <button
      v-if="hydrated"
      style="
        background-color: rgb(246, 179, 82);
        border: 0 solid #e2e8f0;
        border-radius: 4px;
        color: rgb(24, 24, 24);
        cursor: pointer;
        display: block;
        font-weight: 700;
        margin: 0 auto 12px;
        padding: 8px 16px;
      "
      @click="count++"
    >
      Remote counter: {{ count }}
    </button>
    <span
      :style="{
        alignItems: 'center',
        background: hydrated
          ? 'linear-gradient(135deg, rgba(156, 224, 170, 0.2), rgba(246, 179, 82, 0.12))'
          : 'rgba(255, 255, 255, 0.08)',
        borderRadius: '999px',
        boxShadow: hydrated
          ? 'inset 0 0 0 1px rgba(156, 224, 170, 0.18)'
          : 'none',
        color: hydrated ? '#9ce0aa' : '#aeb4bc',
        display: 'inline-flex',
        fontSize: '12px',
        fontWeight: 700,
        gap: '7px',
        lineHeight: 1,
        padding: '7px 11px',
      }"
    >
      <span
        :style="{
          background: hydrated ? '#9ce0aa' : '#aeb4bc',
          borderRadius: '50%',
          boxShadow: hydrated ? '0 0 8px rgba(156, 224, 170, 0.75)' : 'none',
          display: 'inline-block',
          height: '7px',
          width: '7px',
        }"
      />
      {{ hydrated ? "Hydrated" : "SSR" }}
    </span>
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

.theme {
  margin: 10px 0 16px;
  font-size: 12px;
  color: #c9cdd3;
}

.counter {
  background-color: rgb(246, 179, 82);
  border: 0 solid #e2e8f0;
  border-radius: 4px;
  color: rgb(24, 24, 24);
  cursor: pointer;
  display: block;
  font-weight: 700;
  margin: 0 auto 12px;
  padding: 8px 16px;
}

.badge {
  align-items: center;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  color: #aeb4bc;
  display: inline-flex;
  font-size: 12px;
  font-weight: 700;
  gap: 7px;
  line-height: 1;
  padding: 7px 11px;
}

.badge.hydrated {
  background: linear-gradient(
    135deg,
    rgba(156, 224, 170, 0.2),
    rgba(246, 179, 82, 0.12)
  );
  box-shadow: inset 0 0 0 1px rgba(156, 224, 170, 0.18);
  color: #9ce0aa;
}

.dot {
  background: #aeb4bc;
  border-radius: 50%;
  display: inline-block;
  height: 7px;
  width: 7px;
}

.hydrated .dot {
  background: #9ce0aa;
  box-shadow: 0 0 8px rgba(156, 224, 170, 0.75);
}
</style>
