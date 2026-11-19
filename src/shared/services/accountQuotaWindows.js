import { SNAPSHOT_MAX_AGE_MS, isWindowStrategy } from "@/shared/utils/accountOrdering";

// Shared across Next server bundles and hot reloads. No provider imports on auth's path.
const state = globalThis.__accountQuotaWindows ??= {
  snapshots: new Map(), failures: new Map(), providers: new Map(),
  active: new Set(), pending: new Set(), queue: [], running: 0, timer: null,
};
export const ACCOUNT_QUOTA_TTL_MS = SNAPSHOT_MAX_AGE_MS;
const COLLECTION_INTERVAL_MS = 5 * 60_000;
const REFRESH_MS = 60_000;
const MAX_ENTRIES = 2000;
const SUPPORTED = new Set(["claude", "codex"]);
let usageModule;

function bound(map) {
  while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value);
}

// Explicit allowlist: upstream usage objects may contain account/credential metadata.
export function recordAccountQuotaSnapshot(connectionId, usage, providerId) {
  if (!SUPPORTED.has(providerId) || !usage?.quotas || usage.error) return false;
  const quotas = Object.create(null);
  for (const [key, quota] of Object.entries(usage.quotas)) {
    if (!quota || typeof quota !== "object") continue;
    quotas[key] = Object.fromEntries(
      ["resetAt", "used", "total", "remaining", "remainingPercentage", "usedPercentage", "unlimited"]
        .filter((field) => ["string", "number", "boolean"].includes(typeof quota[field]))
        .map((field) => [field, quota[field]])
    );
  }
  state.snapshots.delete(connectionId);
  state.snapshots.set(connectionId, {
    providerId, snapshot: Object.freeze({ fetchedAt: Date.now(), quotas: Object.freeze(
      Object.fromEntries(Object.entries(quotas).map(([key, quota]) => [key, Object.freeze(quota)]))
    ) }),
  });
  state.failures.delete(connectionId);
  bound(state.snapshots);
  return true;
}

export function getAccountQuotaSnapshot(connectionId) {
  const entry = state.snapshots.get(connectionId);
  if (!entry) return null;
  if (Date.now() - entry.snapshot.fetchedAt >= ACCOUNT_QUOTA_TTL_MS) {
    state.snapshots.delete(connectionId);
    return null;
  }
  return entry.snapshot;
}

async function drain() {
  if (state.running >= 2) return;
  const connection = state.queue.shift();
  if (!connection) return;
  if (!state.active.has(connection.provider)) {
    state.pending.delete(connection.id);
    return drain();
  }
  state.running++;
  try {
    const { collectProviderUsage } = await (usageModule ??= import("@/shared/services/providerUsage"));
    const usage = await collectProviderUsage(connection, { force: true });
    if (!recordAccountQuotaSnapshot(connection.id, usage, connection.provider)) throw new Error("Quota unavailable");
  } catch {
    const previous = state.failures.get(connection.id);
    const attempts = Math.min((previous?.attempts || 0) + 1, 5);
    state.failures.set(connection.id, { attempts, retryAt: Date.now() + Math.min(REFRESH_MS * 2 ** (attempts - 1), 15 * REFRESH_MS) });
    bound(state.failures);
  } finally {
    state.running--;
    state.pending.delete(connection.id);
    void drain();
  }
}

async function enqueueProvider(providerId, providerState) {
  try {
    const { getProviderConnections } = await import("@/lib/localDb");
    const connections = await getProviderConnections({ provider: providerId, isActive: true });
    if (!state.active.has(providerId)) return;
    const ids = new Set(connections.map((connection) => connection.id));
    for (const [id, entry] of state.snapshots) {
      if (entry.providerId === providerId && !ids.has(id)) state.snapshots.delete(id);
    }
    for (const connection of connections) {
      if (connection.authType !== "oauth" || state.pending.has(connection.id)) continue;
      const snapshot = getAccountQuotaSnapshot(connection.id);
      if (snapshot && Date.now() - snapshot.fetchedAt < COLLECTION_INTERVAL_MS) continue;
      if (Date.now() < (state.failures.get(connection.id)?.retryAt || 0)) continue;
      state.pending.add(connection.id);
      state.queue.push(connection);
    }
    void drain();
    void drain();
  } catch {
    // Listing failures also back off, independently of inference request volume.
  } finally {
    providerState.listing = false;
  }
}

// Deliberately synchronous: caller may hold auth mutex. All DB/network work starts next tick.
export function ensureProviderQuotaWindows(providerId) {
  if (!SUPPORTED.has(providerId) || !state.active.has(providerId)) return;
  const providerState = state.providers.get(providerId) || { listing: false, checkedAt: 0 };
  state.providers.set(providerId, providerState);
  if (providerState.listing || Date.now() - providerState.checkedAt < 15_000) return;
  providerState.listing = true;
  providerState.checkedAt = Date.now();
  const timer = setTimeout(() => { void enqueueProvider(providerId, providerState); }, 0);
  timer.unref?.();
}

export function configureAccountQuotaWindows(settings) {
  const active = new Set(Object.entries(settings?.providerStrategies || {})
    .filter(([provider, config]) => SUPPORTED.has(provider)
      && isWindowStrategy(config?.fallbackStrategy))
    .map(([provider]) => provider));
  state.active = active;
  if (!active.size && state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  if (active.size && !state.timer) {
    state.timer = setInterval(() => {
      for (const provider of state.active) ensureProviderQuotaWindows(provider);
    }, REFRESH_MS);
    state.timer.unref?.();
  }
  for (const provider of active) ensureProviderQuotaWindows(provider);
}

export async function getProviderQuotaWindows(providerId) {
  const { getProviderConnections } = await import("@/lib/localDb");
  const connections = await getProviderConnections({ provider: providerId, isActive: true });
  ensureProviderQuotaWindows(providerId);
  const snapshots = Object.fromEntries(connections.flatMap(({ id }) => {
    const snapshot = getAccountQuotaSnapshot(id);
    return snapshot ? [[id, snapshot]] : [];
  }));
  const refreshing = state.providers.get(providerId)?.listing === true
    || connections.some(({ id }) => state.pending.has(id));
  return { snapshots, refreshing };
}
