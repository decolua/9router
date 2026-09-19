import { isAutomaticModelSyncEnabled, syncDueConnectionCatalogs, RETRY_DELAY_MS, DAY_MS } from "./connectionCatalog.js";

const STARTUP_DELAY_MS = 90_000;
let timer = null;

export function startConnectionCatalogSync() {
  // Cheap early-out only: CONNECTION_MODEL_SYNC=off is enforced for every
  // automatic caller inside syncConnectionCatalog (chokepoint, T1.5 M4).
  if (timer || !isAutomaticModelSyncEnabled()) return;
  const schedule = (delay) => {
    timer = setTimeout(async () => {
      try {
        const results = await syncDueConnectionCatalogs();
        const failed = results.some((result) => result.error);
        schedule(failed ? RETRY_DELAY_MS : DAY_MS);
      } catch {
        schedule(RETRY_DELAY_MS);
      }
    }, delay);
    timer.unref?.();
  };
  schedule(STARTUP_DELAY_MS);
}
