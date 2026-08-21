import {
  getProxyPoolById,
  listProxyPoolFitness,
  upsertProxyPoolFitness,
  deleteProxyPoolFitness,
  clearProxyPoolFitness,
} from "@/models";

const FITNESS_STATE_KEY = "__9routerPoolFitness__";
const fitness = (globalThis[FITNESS_STATE_KEY] ??= new Map());

export const POOL_UNFIT_MS = 5 * 60 * 1000;

function setPoolFitness(poolId, entries) {
  if (entries.length) fitness.set(poolId, new Map(entries.map((entry) => [entry.scope, { until: entry.until, reason: entry.reason || "" }])));
  else fitness.delete(poolId);
}

function entriesFromMap(poolId) {
  const byScope = fitness.get(poolId);
  return byScope ? [...byScope.entries()].map(([scope, entry]) => ({ poolId, scope, ...entry })) : [];
}

function updateCachedFitness(poolId, scope, until, reason = "") {
  const byScope = fitness.get(poolId) || new Map();
  byScope.set(scope, { until, reason });
  fitness.set(poolId, byScope);
}

async function migrateLegacyFitness(poolId) {
  const pool = await getProxyPoolById(poolId);
  const legacy = Object.entries(pool?.fitness || {}).filter(([, entry]) => Number.isFinite(entry?.until));
  if (!legacy.length) return;
  await Promise.all(legacy.map(([scope, entry]) => upsertProxyPoolFitness(poolId, scope, entry.until, entry.reason || "")));
}

export async function loadPoolFitness(poolId) {
  if (!poolId) return;
  try {
    let entries = await listProxyPoolFitness(poolId);
    if (!entries.length) {
      await migrateLegacyFitness(poolId);
      entries = await listProxyPoolFitness(poolId);
    }
    const now = Date.now();
    const active = entries.filter((entry) => entry.until > now);
    setPoolFitness(poolId, active);
    const expired = entries.filter((entry) => entry.until <= now);
    if (expired.length) await Promise.all(expired.map((entry) => deleteProxyPoolFitness(poolId, entry.scope)));
  } catch {
  }
}

export async function markPoolUnfit(poolId, scope, until = Date.now() + POOL_UNFIT_MS, reason = "") {
  if (!poolId || !scope || !Number.isFinite(until)) return false;
  try {
    await upsertProxyPoolFitness(poolId, scope, until, reason);
    updateCachedFitness(poolId, scope, until, reason);
    return true;
  } catch {
    return false;
  }
}

export async function clearPoolUnfit(poolId, scope) {
  if (!poolId || !scope) return false;
  try {
    await deleteProxyPoolFitness(poolId, scope);
    const byScope = fitness.get(poolId);
    if (byScope) {
      byScope.delete(scope);
      if (byScope.size === 0) fitness.delete(poolId);
    }
    return true;
  } catch {
    return false;
  }
}

function providerWildcardScope(scope) {
  const sep = String(scope || "").indexOf("::");
  if (sep < 0) return null;
  return `${scope.slice(0, sep)}::*`;
}

export function isPoolFit(poolId, scope, now = Date.now()) {
  if (!poolId) return true;
  const byScope = fitness.get(poolId);
  if (!byScope) return true;
  for (const key of [scope, providerWildcardScope(scope)]) {
    if (!key) continue;
    const entry = byScope.get(key);
    if (!entry) continue;
    if (entry.until <= now) {
      byScope.delete(key);
      if (byScope.size === 0) fitness.delete(poolId);
      continue;
    }
    return false;
  }
  return true;
}

export function fitPoolIds(poolIds, scope, now = Date.now()) {
  return (poolIds || []).filter((id) => isPoolFit(id, scope, now));
}

export async function clearAllPoolUnfit(provider = null) {
  try {
    await clearProxyPoolFitness(provider);
    if (!provider) fitness.clear();
    else {
      const prefix = `${provider}::`;
      for (const [poolId, byScope] of fitness) {
        for (const scope of [...byScope.keys()]) if (scope.startsWith(prefix)) byScope.delete(scope);
        if (!byScope.size) fitness.delete(poolId);
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function resetPoolFitness() {
  try {
    await clearProxyPoolFitness();
    fitness.clear();
    return true;
  } catch {
    return false;
  }
}

export async function pruneExpired(now = Date.now()) {
  const entries = await listProxyPoolFitness();
  const expired = entries.filter((entry) => entry.until <= now);
  await Promise.all(expired.map((entry) => deleteProxyPoolFitness(entry.poolId, entry.scope)));
  for (const entry of expired) {
    const byScope = fitness.get(entry.poolId);
    byScope?.delete(entry.scope);
    if (byScope && !byScope.size) fitness.delete(entry.poolId);
  }
  return expired.length;
}

export async function poolFitnessSnapshot(now = Date.now()) {
  const entries = await listProxyPoolFitness();
  const out = {};
  for (const entry of entries) {
    if (entry.until <= now) {
      await deleteProxyPoolFitness(entry.poolId, entry.scope);
      continue;
    }
    const byScope = out[entry.poolId] || (out[entry.poolId] = {});
    byScope[entry.scope] = { until: entry.until, reason: entry.reason || "" };
    setPoolFitness(entry.poolId, entriesFromMap(entry.poolId).concat(entry));
  }
  return out;
}
