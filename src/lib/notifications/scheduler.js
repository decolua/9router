import { getNotificationsRepo } from "@/lib/db/index.js";
import { readSources, readProbes } from "./sources.js";
import { reconcile, drain } from "./store.js";

const interval = 60_000;
const timerKey = Symbol.for("9router.notifications.timer");

export function startNotifications() {
  if (globalThis[timerKey]) return;
  let running = false;
  globalThis[timerKey] = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const repo = await getNotificationsRepo();
      const now = Date.now();
      // Shared SQLite lease also covers overlapping standalone workers.
      if (!repo.claimTick(now, interval)) return;
      const probes = await readProbes();
      repo.withSnapshot(() => reconcile(repo, { ...readSources(repo, now), ...probes }, now));
      await drain(repo);
    } catch { console.warn("[notifications] Evaluation failed"); }
    finally { running = false; }
  }, interval);
  globalThis[timerKey].unref?.();
}
