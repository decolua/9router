// Free-model auto-discovery scheduler.
//
// Periodically fetches the public model catalogs advertised by free-tier
// providers (registry entries with category "free"/"freeTier" that expose a
// modelsFetcher with a known filter) and persists them so they surface in
// /v1/models, dashboard pickers and combos even when the provider has no
// stored connection (noAuth providers get a virtual connection per-request,
// but the model listing path only walks real connections).
//
// Persistence:
//   - kv scope "freeModels" (freeModelsRepo) — source of truth for listing
//   - customModels upserts — visibility in dashboard pickers/combos; entries
//     removed upstream are deleted again (we only ever delete ids present in
//     our previous sync snapshot)
//   - combos listed in settings.freeModelSync.autoComboIds are rewritten with
//     the full ordered member list each tick ("keep in sync" combos)
import { getSettings, getFreeModels, getFreeModelsForProvider, setFreeModels, addCustomModel, deleteCustomModel, getComboById, updateCombo } from "@/lib/localDb";
import { FILTERS } from "@/app/api/providers/suggested-models/filters.js";
import REGISTRY from "open-sse/providers/registry/index.js";

const FETCH_TIMEOUT_MS = 15000;
const ALLOWED_INTERVAL_HOURS = [4, 8, 12, 24];
const DEFAULT_CONFIG = { enabled: false, intervalHours: 4, autoComboIds: [] };

// Survive Next.js hot reload — one scheduler + run state per server process.
const g = (global.__freeModelSync ??= {
  interval: null,
  running: false,
  lastRunAt: null,
  lastError: null,
});

export function normalizeFreeModelSyncConfig(raw) {
  const cfg = { ...DEFAULT_CONFIG, ...(raw || {}) };
  cfg.enabled = cfg.enabled === true;
  if (!ALLOWED_INTERVAL_HOURS.includes(cfg.intervalHours)) cfg.intervalHours = DEFAULT_CONFIG.intervalHours;
  cfg.autoComboIds = Array.isArray(cfg.autoComboIds) ? cfg.autoComboIds.filter((id) => typeof id === "string") : [];
  return cfg;
}

// Free/freeTier registry entries exposing a public catalog we can filter.
export function getSyncTargets() {
  return REGISTRY
    .filter((r) =>
      (r.category === "free" || r.category === "freeTier") &&
      r.modelsFetcher?.url &&
      typeof FILTERS[r.modelsFetcher.type] === "function"
    )
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
}

function providerAlias(entry) {
  return entry.uiAlias || entry.alias || entry.id;
}

async function fetchProviderModels(entry) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(entry.modelsFetcher.url, {
      headers: { ...(entry.transport?.headers || {}) },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const raw = Array.isArray(json) ? json : (json.data ?? json.models ?? []);
    const filtered = FILTERS[entry.modelsFetcher.type](Array.isArray(raw) ? raw : []);
    return filtered.filter((m) => m?.id);
  } finally {
    clearTimeout(timer);
  }
}

// One sync pass over every target. Per-provider failures are isolated — one
// dead endpoint never blocks the others (fail-open, like the schedulers it
// mirrors in quotaAutoPing.js / backgroundTokenRefresh.js).
export async function runFreeModelSync() {
  if (g.running) {
    return { skipped: true, reason: "already-running", lastRunAt: g.lastRunAt };
  }
  g.running = true;
  const results = {};
  let addedTotal = 0;
  let removedTotal = 0;
  try {
    const settings = await getSettings();
    const targets = getSyncTargets();
    for (const target of targets) {
      const alias = providerAlias(target);
      try {
        const prev = await getFreeModelsForProvider(target.id);
        const prevIds = prev?.ids || [];
        const models = await fetchProviderModels(target);
        const nextIds = models.map((m) => m.id);
        const nextSet = new Set(nextIds);

        await setFreeModels(target.id, nextIds);

        let added = 0;
        let removed = 0;
        for (const m of models) {
          if (prevIds.includes(m.id)) continue;
          await addCustomModel({ providerAlias: alias, id: m.id, type: "llm", name: m.name || m.id });
          added += 1;
        }
        // Only remove customs for ids captured by a previous snapshot, so
        // user-created customs that predate the first sync are untouched.
        if (prev) {
          for (const id of prevIds) {
            if (nextSet.has(id)) continue;
            await deleteCustomModel({ providerAlias: alias, id, type: "llm" });
            removed += 1;
          }
        }

        addedTotal += added;
        removedTotal += removed;
        results[target.id] = { count: nextIds.length, added, removed };
      } catch (err) {
        results[target.id] = { error: err?.message || String(err) };
      }
    }

    // Rebuild ordered members from persisted state (authoritative after diff).
    const catalogs = await getFreeModels();
    const ordered = [];
    for (const target of targets) {
      const ids = catalogs[target.id]?.ids || [];
      for (const id of ids) ordered.push(`${providerAlias(target)}/${id}`);
    }
    await refreshAutoCombos(settings, ordered);

    g.lastRunAt = new Date().toISOString();
    g.lastError = null;
    console.log(`[FreeModelSync] done: +${addedTotal} / -${removedTotal} across ${targets.length} providers`);
    return { skipped: false, added: addedTotal, removed: removedTotal, providers: results, at: g.lastRunAt };
  } catch (err) {
    g.lastError = err?.message || String(err);
    console.log("[FreeModelSync] run failed:", g.lastError);
    return { skipped: false, error: g.lastError, providers: results };
  } finally {
    g.running = false;
  }
}

async function refreshAutoCombos(settings, orderedMemberIds) {
  const autoComboIds = normalizeFreeModelSyncConfig(settings?.freeModelSync).autoComboIds;
  for (const comboId of autoComboIds) {
    try {
      const combo = await getComboById(comboId);
      if (!combo) continue; // deleted by user — leave the stale id, UI cleans it up
      await updateCombo(combo.id, { models: [...orderedMemberIds] });
    } catch (err) {
      console.log(`[FreeModelSync] auto-combo refresh failed (${comboId}):`, err?.message || err);
    }
  }
}

export async function startFreeModelSync() {
  const settings = await getSettings();
  configureFreeModelSync(settings);
}

export function stopFreeModelSync() {
  if (g.interval) {
    clearInterval(g.interval);
    g.interval = null;
  }
}

// Idempotent reconfigure — safe to call on every settings PATCH and startup.
export function configureFreeModelSync(settings) {
  stopFreeModelSync();
  const cfg = normalizeFreeModelSyncConfig(settings?.freeModelSync);
  if (!cfg.enabled) return;

  // Immediate first pass, then fixed cadence. Fire-and-forget like AutoPing.
  runFreeModelSync().catch(() => {});
  g.interval = setInterval(() => {
    runFreeModelSync().catch((err) => console.log("[FreeModelSync] tick failed:", err?.message || err));
  }, cfg.intervalHours * 60 * 60 * 1000);
  if (g.interval.unref) g.interval.unref();
  console.log(`[FreeModelSync] scheduler started (every ${cfg.intervalHours}h)`);
}

export async function getFreeModelSyncStatus() {
  const settings = await getSettings();
  const catalogs = await getFreeModels();
  return {
    config: normalizeFreeModelSyncConfig(settings?.freeModelSync),
    running: g.running,
    lastRunAt: g.lastRunAt,
    lastError: g.lastError,
    targets: getSyncTargets().map((t) => ({
      id: t.id,
      alias: providerAlias(t),
      url: t.modelsFetcher.url,
      type: t.modelsFetcher.type,
    })),
    providers: Object.fromEntries(
      Object.entries(catalogs).map(([id, entry]) => [id, { ids: entry.ids, count: entry.ids.length, updatedAt: entry.updatedAt }])
    ),
  };
}
