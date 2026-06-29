export const useCounterStore = defineStore("counter", {
  state: () => ({ count: 0 }),
  getters: {
    getCount(): number {
      return this.count;
    },
  },
  actions: {
    increment() {
      this.count++;
    },
  },
});
