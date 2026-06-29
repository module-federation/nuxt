<script setup lang="ts">
import Counter from "./counter.vue";
</script>

<template>
  <div class="host-card" data-e2e="APP__CARD">
    <div class="icon">
      <svg
        enable-background="new 0 0 512 512"
        height="100px"
        id="Layer_1"
        version="1.1"
        viewBox="0 0 512 512"
        width="100px"
        xmlns="http://www.w3.org/2000/svg"
        data-e2e="STAR__SYMBOL"
      >
        <path
          d="M316.01,199.02L256.134,14.817L196.239,199.02H1.134l158.102,113.324L98.53,496.487l157.604-114.232  l157.585,114.232l-60.687-184.143L511.134,199.02H316.01z M335.084,318.257l42.407,128.63L267.22,366.963l-11.086-8.033  l-11.086,8.033l-110.291,79.923l42.408-128.63l4.353-13.18l-11.289-8.08L59.903,217.909h136.336h13.724l4.242-13.051l41.929-128.957  l41.91,128.957l4.242,13.051h13.724h136.336l-110.327,79.088l-11.27,8.08L335.084,318.257z"
          fill="#f6b352"
        />
      </svg>
    </div>
    <div class="title">I'm the host app</div>
    <Counter />
  </div>
</template>

<style scoped>
.host-card {
  background: #3178c6;
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
</style>
