export async function runWithConcurrency(items = [], limit = 1, worker = async () => {}) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1;
  const results = new Array(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(safeLimit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      } catch (error) {
        console.error("[ProviderLimits] Queued refresh item failed:", error);
      }
    }
  });

  await Promise.all(runners);
  return results;
}

export function createSingleFlight() {
  let inFlight = null;

  return async function runSingleFlight(work) {
    if (inFlight) return inFlight;

    const promise = (async () => {
      try {
        return await work();
      } finally {
        inFlight = null;
      }
    })();

    inFlight = promise;
    return promise;
  };
}
