type Listener = () => void;

export function createSharedTicker(intervalMs: number) {
  const listeners = new Set<Listener>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const start = () => {
    if (timer) return;
    timer = setInterval(() => {
      listeners.forEach((listener) => listener());
    }, intervalMs);
  };

  const stop = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  };

  return {
    subscribe(listener: Listener) {
      listeners.add(listener);
      start();

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
  };
}

export const usageTimeAgoTicker = createSharedTicker(5000);
