import { getApiKeys } from "@/lib/localDb";
import { makeKv } from "@/lib/db/helpers/kvStore.js";
import { getApiKeyQuotaPercent } from "@/lib/auth/apiKeyAuthorization";
import { getCodexUsage } from "open-sse/services/usage/codex.js";
import { getClaudeUsage } from "open-sse/services/usage/claude.js";

const quotaStore = makeKv("apiKeyQuota");
const SUPPORTED_PROVIDERS = new Set(["codex", "claude"]);
const SNAPSHOT_TTL_MS = 10000;
const RESET_DRIFT_TOLERANCE_MS = 5 * 60 * 1000;
const MODEL_RATE_ALPHA = 0.3;
const snapshotCache = new Map();
const queues = new Map();
const reservations = new Map();

function withConnectionLock(connectionId, fn) {
  const previous = queues.get(connectionId) || Promise.resolve();
  const current = previous.catch(() => {}).then(fn);
  queues.set(connectionId, current);
  return current.finally(() => {
    if (queues.get(connectionId) === current) queues.delete(connectionId);
  });
}

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function quotaRank(name) {
  const lower = String(name).toLowerCase();
  if (lower.includes("session") || lower.includes("5h") || lower.includes("five")) return 0;
  if (lower.includes("weekly") || lower.includes("7d") || lower.includes("seven")) return 1;
  return 2;
}

function isPrimaryAccountQuota(name) {
  const lower = String(name).toLowerCase();
  return lower === "session"
    || lower === "weekly"
    || lower === "session (5h)"
    || lower === "weekly (7d)";
}

export function selectShortestQuota(quotas, _provider, _model, nowMs = Date.now()) {
  return Object.entries(quotas || {})
    .filter(([name]) => isPrimaryAccountQuota(name))
    .map(([name, quota]) => {
      const used = number(quota?.used, quota?.total ? 100 - ((number(quota.remaining, 0) / quota.total) * 100) : null);
      const resetMs = new Date(quota?.resetAt).getTime();
      if (used === null || !Number.isFinite(resetMs) || resetMs <= nowMs) return null;
      return {
        name,
        used: Math.max(0, Math.min(100, used)),
        resetAt: new Date(resetMs).toISOString(),
        rank: quotaRank(name),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank || b.used - a.used)[0] || null;
}

function proxyOptions(credentials) {
  const data = credentials?.providerSpecificData || {};
  return {
    connectionProxyEnabled: data.connectionProxyEnabled === true,
    connectionProxyUrl: data.connectionProxyUrl || "",
    connectionNoProxy: data.connectionNoProxy || "",
    vercelRelayUrl: data.vercelRelayUrl || "",
    strictProxy: false,
  };
}

async function fetchQuotaSnapshot({ connectionId, provider, model, credentials, force = false }) {
  if (!SUPPORTED_PROVIDERS.has(provider) || !credentials?.accessToken) return null;
  const cached = snapshotCache.get(connectionId);
  if (!force && cached?.expiresAt > Date.now() && cached.model === model) return cached.snapshot;

  const options = proxyOptions(credentials);
  const usage = provider === "codex"
    ? await getCodexUsage(credentials.accessToken, options)
    : await getClaudeUsage(credentials.accessToken, options, { force });
  const snapshot = selectShortestQuota(usage?.quotas, provider, model);
  if (snapshot) snapshotCache.set(connectionId, { snapshot, model, expiresAt: Date.now() + SNAPSHOT_TTL_MS });
  return snapshot;
}

function newWindow(snapshot, profileRates = {}) {
  return {
    windowKey: `${snapshot.name}:${snapshot.resetAt}`,
    quotaName: snapshot.name,
    resetAt: snapshot.resetAt,
    baselineUsed: snapshot.used,
    lastUsed: snapshot.used,
    charged: {},
    pending: {},
    profileRates,
    lastRate: 0,
    updatedAt: new Date().toISOString(),
  };
}

function normalizePendingEntry(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      weight: Math.max(0, number(value.weight, 0)),
      models: value.models && typeof value.models === "object" ? value.models : {},
    };
  }
  const weight = Math.max(0, number(value, 0));
  return { weight, models: weight > 0 ? { __unknown__: weight } : {} };
}

function learnedProfileRate(state, profileKey) {
  return number((state?.profileRates || state?.modelRates)?.[profileKey]?.rate, null);
}

function averageLearnedRate(state) {
  const rates = Object.values(state?.profileRates || state?.modelRates || {}).map((entry) => number(entry?.rate, null)).filter((rate) => rate !== null);
  return rates.length > 0 ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length : null;
}

function fallbackModelRate(state) {
  const lastRate = number(state?.lastRate, 0);
  if (lastRate > 0) return lastRate;
  const learned = averageLearnedRate(state);
  if (learned !== null) return learned;
  return 1;
}

function effectiveWeight(state, entry) {
  const normalized = normalizePendingEntry(entry);
  const fallback = fallbackModelRate(state);
  return Object.entries(normalized.models).reduce((sum, [profileKey, rawWeight]) => {
    const rate = learnedProfileRate(state, profileKey) ?? fallback;
    return sum + (Math.max(0, number(rawWeight, 0)) * rate);
  }, 0);
}

function addPending(state, apiKeyId, profileKey, weight) {
  const entry = normalizePendingEntry(state.pending?.[apiKeyId]);
  entry.weight += weight;
  entry.models[profileKey] = number(entry.models[profileKey], 0) + weight;
  state.pending[apiKeyId] = entry;
}

function learnProfileRate(state, profileKey, sampleRate) {
  if (!profileKey || profileKey === "__unknown__" || !Number.isFinite(sampleRate) || sampleRate <= 0) return;
  state.profileRates ||= state.modelRates || {};
  delete state.modelRates;
  const previous = state.profileRates[profileKey];
  const rate = previous
    ? (previous.rate * (1 - MODEL_RATE_ALPHA)) + (sampleRate * MODEL_RATE_ALPHA)
    : sampleRate;
  state.profileRates[profileKey] = { rate, samples: (previous?.samples || 0) + 1 };
}

function sameQuotaWindow(state, snapshot, nowMs = Date.now()) {
  if (!state || state.quotaName !== snapshot.name) return false;
  const previousReset = new Date(state.resetAt).getTime();
  const nextReset = new Date(snapshot.resetAt).getTime();
  if (!Number.isFinite(previousReset) || !Number.isFinite(nextReset)) return false;
  if (previousReset <= nowMs && nextReset > nowMs) return false;
  return Math.abs(nextReset - previousReset) <= RESET_DRIFT_TOLERANCE_MS;
}

function reconcile(state, snapshot, chargePendingOnReset = false) {
  if (!state) return newWindow(snapshot);
  if (!sameQuotaWindow(state, snapshot)) {
    const retainedRates = state.quotaName === snapshot.name ? (state.profileRates || state.modelRates || {}) : {};
    if (!chargePendingOnReset || Object.keys(state.pending || {}).length === 0) return newWindow(snapshot, retainedRates);
    const next = newWindow({ ...snapshot, used: 0 }, retainedRates);
    next.pending = state.pending;
    return reconcile(next, snapshot);
  }

  const delta = Math.max(0, snapshot.used - number(state.lastUsed, snapshot.used));
  const pending = state.pending || {};
  const entries = Object.entries(pending).map(([apiKeyId, value]) => [apiKeyId, normalizePendingEntry(value)]);
  const totalWeight = entries.reduce((sum, [, entry]) => sum + entry.weight, 0);
  if (delta > 0 && totalWeight > 0) {
    const modelTotals = {};
    for (const [, entry] of entries) {
      for (const [modelKey, weight] of Object.entries(entry.models)) {
        modelTotals[modelKey] = number(modelTotals[modelKey], 0) + Math.max(0, number(weight, 0));
      }
    }
    const observedModels = Object.entries(modelTotals).filter(([, weight]) => weight > 0);
    if (observedModels.length === 1) {
      const [profileKey, weight] = observedModels[0];
      learnProfileRate(state, profileKey, delta / weight);
    }

    const weightedEntries = entries.map(([apiKeyId, entry]) => [apiKeyId, effectiveWeight(state, entry)]);
    const totalEffectiveWeight = weightedEntries.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [apiKeyId, weight] of weightedEntries) {
      const share = totalEffectiveWeight > 0 ? weight / totalEffectiveWeight : normalizePendingEntry(pending[apiKeyId]).weight / totalWeight;
      state.charged[apiKeyId] = number(state.charged[apiKeyId], 0) + (delta * share);
    }
    state.lastRate = delta / totalWeight;
    state.pending = {};
  }
  state.lastUsed = snapshot.used;
  state.quotaName = snapshot.name;
  state.resetAt = snapshot.resetAt;
  state.updatedAt = new Date().toISOString();
  return state;
}

async function connectionHasQuotaPolicy(connectionId) {
  const keys = await getApiKeys();
  return keys.some((key) => getApiKeyQuotaPercent(key, connectionId) !== null);
}

function activeReservationUsage(state, connectionId, apiKeyId) {
  if (!connectionId) return 0;
  const bucket = reservations.get(connectionId);
  if (!bucket || bucket.size === 0) return 0;
  const combined = { weight: 0, models: {} };
  for (const reservation of bucket) {
    if (reservation.apiKeyId !== apiKeyId) continue;
    combined.weight += reservation.weight;
    combined.models[reservation.profile] = number(combined.models[reservation.profile], 0) + reservation.weight;
  }
  return effectiveWeight(state, combined);
}

function addReservation(connectionId, apiKeyId, profile, weight) {
  const reservation = { connectionId, apiKeyId, profile, weight };
  let bucket = reservations.get(connectionId);
  if (!bucket) {
    bucket = new Set();
    reservations.set(connectionId, bucket);
  }
  bucket.add(reservation);
  return reservation;
}

function removeReservation(reservation) {
  const connectionId = reservation?.connectionId;
  if (!connectionId) return;
  const bucket = reservations.get(connectionId);
  if (!bucket) return;
  bucket.delete(reservation);
  if (bucket.size === 0) reservations.delete(connectionId);
}

function keyUsage(state, apiKeyId, connectionId = null) {
  const charged = number(state?.charged?.[apiKeyId], 0);
  const pending = effectiveWeight(state, state?.pending?.[apiKeyId]);
  return charged + pending + activeReservationUsage(state, connectionId, apiKeyId);
}

export async function checkApiKeyQuota({
  apiKeyRecord,
  connectionId,
  provider,
  model,
  credentials,
  reserve = false,
  kind = "chat",
  effort,
  size,
  quality,
  count,
}) {
  const limit = getApiKeyQuotaPercent(apiKeyRecord, connectionId);
  if (limit === null || !SUPPORTED_PROVIDERS.has(provider)) return { limited: false, exceeded: false };

  try {
    return await withConnectionLock(connectionId, async () => {
      const snapshot = await fetchQuotaSnapshot({ connectionId, provider, model, credentials });
      if (!snapshot) return { limited: true, exceeded: false, unavailable: true };
      const state = reconcile(await quotaStore.get(connectionId), snapshot);
      await quotaStore.set(connectionId, state);
      const usedPercent = keyUsage(state, apiKeyRecord.id, connectionId);
      const exceeded = usedPercent >= limit;
      const reservation = !exceeded && reserve
        ? addReservation(
            connectionId,
            apiKeyRecord.id,
            buildQuotaProfile({ provider, model, kind, effort, size, quality }),
            requestWeight(null, kind, count)
          )
        : null;
      return {
        limited: true,
        exceeded,
        usedPercent,
        limit,
        quotaName: state.quotaName,
        resetAt: state.resetAt,
        reservation,
      };
    });
  } catch (error) {
    console.warn(`[API key quota] check failed for ${provider}:${connectionId}: ${error.message}`);
    return { limited: true, exceeded: false, unavailable: true };
  }
}

export async function releaseApiKeyQuotaReservation(reservation) {
  if (!reservation?.connectionId) return;
  await withConnectionLock(reservation.connectionId, async () => {
    removeReservation(reservation);
  });
}

function requestWeight(usage, kind, count = 1) {
  if (kind === "image") return Math.max(1, number(count, 1));
  const prompt = number(usage?.prompt_tokens ?? usage?.input_tokens, 0);
  const completion = number(usage?.completion_tokens ?? usage?.output_tokens, 0);
  // ponytail: 1 unit per ~1k tokens; replace with provider billing units if exposed.
  return Math.max(1, (prompt + completion) / 1000);
}

function cleanProfileValue(value, fallback) {
  const normalized = String(value || fallback).trim().toLowerCase();
  return normalized.replace(/[^a-z0-9._-]+/g, "-");
}

export function buildQuotaProfile({ provider, model, kind = "chat", effort, size, quality }) {
  const base = `${cleanProfileValue(provider, "unknown")}/${cleanProfileValue(model, "unknown")}`;
  if (kind === "image") {
    return `image:${base}:size=${cleanProfileValue(size, "default")}:quality=${cleanProfileValue(quality, "default")}`;
  }
  const normalizedEffort = provider === "codex" && effort === "ultra" ? "max" : effort;
  return `chat:${base}:effort=${cleanProfileValue(normalizedEffort, "default")}`;
}

export async function recordApiKeyQuotaUsage({ apiKeyRecord, connectionId, provider, model, credentials, usage, kind = "chat", effort, size, quality, count, reservation }) {
  try {
    if (!connectionId || !SUPPORTED_PROVIDERS.has(provider)) return;
    if (!(await connectionHasQuotaPolicy(connectionId))) return;
    const apiKeyId = apiKeyRecord?.id || "__unattributed__";

    await withConnectionLock(connectionId, async () => {
      removeReservation(reservation);
      let state = await quotaStore.get(connectionId);
      if (!state) {
        const before = await fetchQuotaSnapshot({ connectionId, provider, model, credentials, force: true });
        if (!before) return;
        state = newWindow(before);
      }
      state.pending ||= {};
      const profile = buildQuotaProfile({ provider, model, kind, effort, size, quality });
      addPending(state, apiKeyId, profile, requestWeight(usage, kind, count));
      await quotaStore.set(connectionId, state);

      const snapshot = await fetchQuotaSnapshot({ connectionId, provider, model, credentials, force: true });
      if (!snapshot) return;
      state = reconcile(state, snapshot, true);
      await quotaStore.set(connectionId, state);
    });
  } catch (error) {
    console.warn(`[API key quota] record failed for ${provider}:${connectionId}: ${error.message}`);
  } finally {
    if (reservation) {
      try {
        await releaseApiKeyQuotaReservation(reservation);
      } catch (error) {
        console.warn(`[API key quota] reservation release failed for ${provider}:${connectionId}: ${error.message}`);
      }
    }
  }
}

export async function getApiKeyQuotaStatus(apiKeyRecord) {
  if (!apiKeyRecord?.id) return {};
  const result = {};
  for (const [connectionId, grant] of Object.entries(apiKeyRecord.authorization?.connections || {})) {
    const limit = number(grant?.quotaPercent, null);
    if (limit === null) continue;
    const state = await quotaStore.get(connectionId);
    result[connectionId] = {
      limit,
      usedPercent: state ? keyUsage(state, apiKeyRecord.id, connectionId) : 0,
      quotaName: state?.quotaName || null,
      resetAt: state?.resetAt || null,
      profiles: Object.entries(state?.profileRates || state?.modelRates || {}).map(([profile, value]) => ({
        profile,
        rate: number(value?.rate, 0),
        samples: number(value?.samples, 0),
      })),
    };
  }
  return result;
}

export const __test__ = { newWindow, reconcile, keyUsage, requestWeight, sameQuotaWindow, addPending };
