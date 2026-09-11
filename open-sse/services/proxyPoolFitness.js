import { hydrateFitnessCache } from "./proxyPoolFitnessLifecycle.js";
import {
  listProxyPoolFitness,
  upsertProxyPoolFitness,
  deleteProxyPoolFitness,
  deleteProxyPoolFitnessVersion,
  clearProxyPoolFitness,
} from "@/models";

const FITNESS_STATE_KEY = "__9routerPoolFitness__";
const fitness = (globalThis[FITNESS_STATE_KEY] ??= new Map());
export const POOL_UNFIT_MS = 5 * 60 * 1000;

function safeLog(value) {
  return String(value || "").replace(/[\r\n\t\0]/g, " ").replace(/https?:\/\/\S+/gi, "[url]").replace(/\b(?:bearer|token|authorization|cookie)\s*[:=]?\s*\S+/gi, "[redacted]");
}
function truncateUtf8(value, maxBytes = 512) {
  let out = "";
  let bytes = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char);
    if (bytes + size > maxBytes) break;
    out += char;
    bytes += size;
  }
  return out;
}
function persistenceLog(operation, error) {
  console.warn(truncateUtf8(`[proxy-fitness] ${operation} failed: ${safeLog(error?.message || error)}`));
}
function setPoolFitness(poolId, entries) {
  if (entries.length) fitness.set(poolId, new Map(entries.map((entry) => [entry.scope, { until: entry.until, reason: entry.reason || "", version: entry.version }])));
  else fitness.delete(poolId);
}
function updateCached(entry) {
  const scopes = fitness.get(entry.poolId) || new Map();
  scopes.set(entry.scope, { until: entry.until, reason: entry.reason || "", version: entry.version });
  fitness.set(entry.poolId, scopes);
}
function removeCached(poolId, scope) {
  const scopes = fitness.get(poolId);
  if (!scopes) return;
  scopes.delete(scope);
  if (!scopes.size) fitness.delete(poolId);
}
export async function loadPoolFitness(poolId, now = Date.now()) {
  if (!poolId) return false;
  try {
    const entries = await listProxyPoolFitness(poolId);
    setPoolFitness(poolId, entries.filter((entry) => entry.until > now));
    for (const entry of entries.filter((entry) => entry.until <= now)) {
      const result = await deleteProxyPoolFitness(poolId, entry.scope);
      if (result.changes) removeCached(poolId, entry.scope);
    }
    return true;
  } catch (error) { persistenceLog("load", error); return false; }
}
export async function markPoolUnfit(poolId, scope, until = Date.now() + POOL_UNFIT_MS, reason = "") {
  if (!poolId || !scope || !Number.isFinite(until)) return null;
  try { const committed = await upsertProxyPoolFitness(poolId, scope, until, reason); if (committed) updateCached(committed); return committed; }
  catch (error) { persistenceLog("mark", error); return null; }
}
export async function observePoolFitnessVersion(poolId, scope) {
  const entry = await observeActivePoolFitness(poolId, scope);
  return entry?.version ?? 0;
}
export async function observeActivePoolFitness(poolId, scope, now = Date.now()) {
  if (!poolId || !scope) return null;
  try {
    const entry = (await listProxyPoolFitness(poolId)).find((candidate) => candidate.scope === scope);
    return entry?.until > now ? entry : null;
  } catch (error) { persistenceLog("observe", error); return undefined; }
}
export async function clearPoolUnfit(poolId, scope, version) {
  if (!poolId || !scope) return false;
  try {
    const result = Number.isInteger(version) ? await deleteProxyPoolFitnessVersion(poolId, scope, version) : await deleteProxyPoolFitness(poolId, scope);
    if (!result.changes) return false;
    removeCached(poolId, scope);
    return true;
  } catch (error) { persistenceLog("clear", error); return false; }
}
function wildcard(scope) { const at = String(scope || "").indexOf("::"); return at < 0 ? null : `${scope.slice(0, at)}::*`; }
export function isPoolFit(poolId, scope, now = Date.now()) {
  const scopes = fitness.get(poolId);
  return !scopes || ![scope, wildcard(scope)].some((key) => key && scopes.get(key)?.until > now);
}
export function fitPoolIds(poolIds, scope, now = Date.now()) { return (poolIds || []).filter((id) => isPoolFit(id, scope, now)); }
export async function clearAllPoolUnfit(provider = null) {
  try {
    await clearProxyPoolFitness(provider);
    if (!provider) {
      fitness.clear();
    } else {
      const prefix = `${provider}::`;
      for (const [poolId, scopes] of fitness) {
        for (const scope of [...scopes.keys()]) {
          if (scope === provider || scope.startsWith(prefix)) scopes.delete(scope);
        }
        if (!scopes.size) fitness.delete(poolId);
      }
    }
    return true;
  }
  catch (error) { persistenceLog("clear-all", error); return false; }
}
export async function resetPoolFitness() { return clearAllPoolUnfit(); }
export function evictPoolFitness(poolId) {
  if (poolId) fitness.delete(poolId);
}
export async function hydratePoolFitness(now = Date.now()) {
  try {
    return await hydrateFitnessCache({
      list: listProxyPoolFitness, remove: deleteProxyPoolFitness,
      setPool: setPoolFitness, removeCached, now,
    });
  } catch (error) { persistenceLog("hydrate", error); return false; }
}
export async function pruneExpired(now = Date.now()) {
  let entries;
  try { entries = await listProxyPoolFitness(); } catch (error) { persistenceLog("prune", error); return 0; }
  let count = 0;
  for (const entry of entries.filter((item) => item.until <= now)) {
    try { const result = await deleteProxyPoolFitness(entry.poolId, entry.scope); if (result.changes) { removeCached(entry.poolId, entry.scope); count += 1; } }
    catch (error) { persistenceLog("prune", error); }
  }
  return count;
}
export async function poolFitnessSnapshot(now = Date.now()) {
  let entries;
  try { entries = await listProxyPoolFitness(); } catch (error) { persistenceLog("snapshot", error); return null; }
  const active = [];
  const retained = new Set();
  for (const entry of entries) {
    if (entry.until > now) active.push(entry);
    else {
      try { const result = await deleteProxyPoolFitness(entry.poolId, entry.scope); if (result.changes) removeCached(entry.poolId, entry.scope); }
      catch (error) { retained.add(`${entry.poolId}\u0000${entry.scope}`); persistenceLog("snapshot", error); }
    }
  }
  const activeKeys = new Set(active.map((entry) => `${entry.poolId}\u0000${entry.scope}`));
  for (const [poolId, scopes] of fitness) for (const entryScope of [...scopes.keys()]) if (!activeKeys.has(`${poolId}\u0000${entryScope}`) && !retained.has(`${poolId}\u0000${entryScope}`)) removeCached(poolId, entryScope);
  const snapshot = {};
  for (const entry of active) { const scopes = snapshot[entry.poolId] || (snapshot[entry.poolId] = {}); scopes[entry.scope] = { until: entry.until, reason: entry.reason || "", version: entry.version }; }
  for (const poolId of new Set(active.map((entry) => entry.poolId))) setPoolFitness(poolId, active.filter((entry) => entry.poolId === poolId));
  return snapshot;
}
