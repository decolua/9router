// Usage retention — bounds the DB's steady-state size to the stats window.
// The product promises ≤60 days of statistics, so nothing needs to outlive
// that horizon:
//   - usageHistory / requestDetails / usageRollupDaily / usageDaily: 61 local
//     days (one grace day past the 60d read window so the oldest visible day
//     never falls off between runs)
//   - usageRollupHourly: 3 local days (hourly grain only serves today/24h)
// Rollups never lose data the reads still want, and the raw tables stay
// available for details/backfill across the whole visible window.
import { getAdapter } from "../driver.js";
import { getMetaSync, setMetaSync } from "../helpers/metaStore.js";

const DAY_MS = 86400000;
export const RAW_HORIZON_DAYS = 61;
export const HOURLY_HORIZON_DAYS = 3;
const RUN_INTERVAL_MS = 12 * 3600 * 1000;

function localDateKeyDaysAgo(days) {
  const d = new Date(Date.now() - days * DAY_MS);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Delete everything past the horizons. Returns per-table change counts.
export async function runRetention() {
  const adapter = await getAdapter();
  const rawCutoffTs = new Date(Date.now() - RAW_HORIZON_DAYS * DAY_MS).toISOString();
  const dailyCutoffKey = localDateKeyDaysAgo(RAW_HORIZON_DAYS);
  const hourlyCutoffKey = localDateKeyDaysAgo(HOURLY_HORIZON_DAYS);

  const counts = {};
  adapter.transaction(() => {
    counts.usageHistory = adapter.run(`DELETE FROM usageHistory WHERE timestamp < ?`, [rawCutoffTs])?.changes || 0;
    counts.requestDetails = adapter.run(`DELETE FROM requestDetails WHERE timestamp < ?`, [rawCutoffTs])?.changes || 0;
    counts.usageRollupDaily = adapter.run(`DELETE FROM usageRollupDaily WHERE dateKey < ?`, [dailyCutoffKey])?.changes || 0;
    counts.usageDaily = adapter.run(`DELETE FROM usageDaily WHERE dateKey < ?`, [dailyCutoffKey])?.changes || 0;
    counts.usageRollupHourly = adapter.run(`DELETE FROM usageRollupHourly WHERE dateKey < ?`, [hourlyCutoffKey])?.changes || 0;
  });

  // Return freed pages to the OS (no-op unless auto_vacuum=INCREMENTAL, which
  // migration 003 enables). Cheap when nothing was deleted.
  const deleted = Object.values(counts).reduce((s, n) => s + n, 0);
  if (deleted > 0) {
    try { adapter.exec(`PRAGMA incremental_vacuum`); } catch {}
  }
  return counts;
}

// Time-gated wrapper: at most one run per RUN_INTERVAL_MS, tracked in _meta
// so a crashed run retries on the next boot instead of waiting out the clock.
export async function runRetentionGated() {
  const adapter = await getAdapter();
  const last = parseInt(getMetaSync(adapter, "lastRetentionAt", "0"), 10) || 0;
  if (Date.now() - last < RUN_INTERVAL_MS) return null;

  const counts = await runRetention();
  setMetaSync(adapter, "lastRetentionAt", String(Date.now()));
  const deleted = Object.values(counts).reduce((s, n) => s + n, 0);
  if (deleted > 0) console.log(`[DB][retention] pruned ${deleted} rows past the ${RAW_HORIZON_DAYS}d horizon`);
  return counts;
}

// Boot hook (driver.initAdapter): run once right away if due, then re-check
// every 12h. Timer is unref'd so it never holds the process open.
export function scheduleRetention() {
  if (global._retentionTimer) return;
  runRetentionGated().catch((e) => console.warn(`[DB][retention] run failed: ${e.message}`));
  global._retentionTimer = setInterval(
    () => runRetentionGated().catch((e) => console.warn(`[DB][retention] run failed: ${e.message}`)),
    RUN_INTERVAL_MS,
  );
  global._retentionTimer.unref?.();
}
