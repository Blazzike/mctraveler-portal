import { defineModule } from '@/module-api/module';

let currentTps = 20.0;
let lastTick = Date.now();
let intervalId: Timer | null = null;

export default defineModule({
  name: 'Tps',
  api: {
    getTps(): number {
      return currentTps;
    },
  },
  onEnable: () => {
    intervalId = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastTick;
      lastTick = now;

      const tps = Math.min(20, 20 * (1000 / Math.max(1000, elapsed)));
      currentTps = currentTps * 0.9 + tps * 0.1;
    }, 1000);
  },
});
