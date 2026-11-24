import { connectionName } from "../usage/reportFields.js";
import { getProviderHealthRows, writeConnectionObservation } from "@/lib/db/index.js";
import { ERROR_CATEGORY as C } from "open-sse/config/inferenceErrors.js";
import { classifyInferenceError } from "open-sse/services/inferenceError.js";

const categories = new Set(Object.values(C));
const iso = value => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

// Keep observation timestamps separate from routing fields (clearAccountError clears lastErrorAt).
export async function observeConnection(id, failure = null, reading = null) {
  if (!id || id === "noauth") return;
  const now = Date.now();
  const at = new Date(now).toISOString();
  try {
    await writeConnectionObservation(id, at, now, failure, reading?.remainingPercentage ?? null, iso(reading?.resetAt));
  } catch { console.warn("[health] Could not persist connection observation"); }
}

export function deriveConnectionState({ isActive, lastErrorCategory, lastSuccessAt, lastErrorAt,
  rateLimitResetAt, locked, unavailable, tested }, now) {
  if (!isActive) return "disabled";
  const current = lastErrorCategory && (!lastSuccessAt || Date.parse(lastErrorAt) > Date.parse(lastSuccessAt));
  if (tested === "needs_reauth" || (current && lastErrorCategory === C.INVALID)) return "needs_reauth";
  if (current && [C.RATE, C.QUOTA].includes(lastErrorCategory) &&
      (Date.parse(rateLimitResetAt) > now || locked || (!rateLimitResetAt && !lastSuccessAt))) return "rate_limited";
  if (unavailable) return "unavailable";
  if (locked || current || tested === "error" || tested === "unavailable") return "degraded";
  return lastSuccessAt || tested === "active" ? "healthy" : "unknown";
}

function connectionObservation(data) {
  const legacyAt = iso(data.lastErrorAt), observedAt = iso(data.observedErrorAt);
  const legacy = legacyAt && (!observedAt || legacyAt > observedAt) && data.lastError;
  const lastErrorAt = legacy ? legacyAt : observedAt ?? legacyAt;
  const lastErrorCategory = legacy ? classifyInferenceError({ status: Number(data.errorCode), body: data.lastError }).category :
    categories.has(data.lastErrorCategory) ? data.lastErrorCategory : null;
  const lastSuccessAt = iso(data.lastSuccessAt);
  const rateLimitResetAt = legacy ? null : iso(data.reportedResetAt);
  return { lastErrorAt, lastErrorCategory, lastSuccessAt, rateLimitResetAt };
}

export function needsReauth(connection) {
  return connection.testStatus === "needs_reauth" || deriveConnectionState({
    ...connectionObservation(connection), isActive: true,
  }, Date.now()) === "needs_reauth";
}

export async function providerHealth(now = Date.now()) {
  const { stats, providerName, rows } = await getProviderHealthRows(now);
  const byId = new Map(stats.map(({ connectionId, ...s }) => [connectionId, s]));
  return connectionStates(rows, now).map(({ data, ...item }) => {
    const { state, lastErrorCategory } = item;
    const percent = data.reportedQuotaPercent;
    const quota = Number.isFinite(percent) && percent >= 0 && percent <= 100 &&
      Date.parse(data.reportedQuotaUntil) > now ? { known: true, remainingPercentage: percent } :
      state === "rate_limited" && lastErrorCategory === C.QUOTA ? { known: true, remaining: 0 } : { known: false };
    // User-editable names may themselves be bearer credentials or email addresses.
    const provider = providerName(item.provider);
    return { ...item, provider, name: connectionName(provider, item.id), quota,
      stats24h: byId.get(item.id) ?? { requests: 0, successRate: null, avgLatencyMs: null, p95LatencyMs: null, totalTokens: 0 } };
  });
}

export function connectionStates(rows, now) {
  return rows.map(row => {
    const data = JSON.parse(row.data || "{}");
    const { lastErrorAt, lastErrorCategory, lastSuccessAt, rateLimitResetAt } = connectionObservation(data);
    const isActive = !!row.isActive;
    const locked = Object.keys(data).some(k => k.startsWith("modelLock_") && Date.parse(data[k]) > now)
      || Date.parse(data.rateLimitedUntil) > now;
    const state = deriveConnectionState({ isActive, lastSuccessAt, lastErrorAt, lastErrorCategory, rateLimitResetAt,
      locked, unavailable: Date.parse(data.unavailableUntil) > now, tested: data.testStatus }, now);
    return { id: row.id, provider: row.provider, data, isActive, state, lastErrorAt, lastErrorCategory, lastSuccessAt, rateLimitResetAt };
  });
}
