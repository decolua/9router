import { updateProviderConnection } from "@/lib/localDb";
import { projectLegacyConnectionState, writeConnectionHotState } from "@/lib/providerHotState";

const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];
const CODEX_LIVE_QUOTA_PATTERNS = [
  "exceeded your current quota",
  "quota exceeded",
  "quota exhausted",
  "insufficient quota",
  "billing hard limit",
  "hard limit reached",
  "usage limit reached",
  "weekly quota exhausted",
];

export function isAuthExpiredMessage(usage) {
  if (!usage?.message) return false;
  const msg = usage.message.toLowerCase();
  return AUTH_EXPIRED_PATTERNS.some((p) => msg.includes(p));
}

export async function syncUsageStatus(connection, updates = {}) {
  if (!connection?.id) return null;

  const lastCheckedAt = updates.lastCheckedAt || updates.lastTested || new Date().toISOString();
  const hotPatch = {
    ...updates,
    lastCheckedAt,
    version: updates.version || Date.now(),
  };
  const snapshot = await writeConnectionHotState({
    connectionId: connection.id,
    provider: connection.provider,
    patch: hotPatch,
  });
  const legacy = projectLegacyConnectionState(snapshot || hotPatch);

  await updateProviderConnection(connection.id, {
    testStatus: legacy.testStatus,
    lastTested: legacy.lastTested || lastCheckedAt,
    lastError: legacy.lastError ?? null,
    lastErrorType: legacy.lastErrorType ?? null,
    lastErrorAt: legacy.lastErrorAt ?? null,
    rateLimitedUntil: legacy.rateLimitedUntil ?? null,
    errorCode: legacy.errorCode ?? null,
  });

  return snapshot || hotPatch;
}

function getHealthyUsageStatusUpdates(usage) {
  const lastCheckedAt = new Date().toISOString();
  return {
    routingStatus: "eligible",
    healthStatus: "healthy",
    quotaState: "ok",
    authState: "ok",
    reasonCode: "unknown",
    reasonDetail: null,
    lastError: null,
    lastErrorType: null,
    lastErrorAt: null,
    rateLimitedUntil: null,
    errorCode: null,
    lastCheckedAt,
    usageSnapshot: JSON.stringify(usage || {}),
    resetAt: null,
    nextRetryAt: null,
  };
}

export function getConnectionRecoveryPatch({ lastCheckedAt = new Date().toISOString() } = {}) {
  return {
    routingStatus: "eligible",
    healthStatus: "healthy",
    quotaState: "ok",
    authState: "ok",
    reasonCode: "unknown",
    reasonDetail: null,
    nextRetryAt: null,
    resetAt: null,
    testStatus: "active",
    lastError: null,
    lastErrorType: null,
    lastErrorAt: null,
    rateLimitedUntil: null,
    errorCode: null,
    backoffLevel: 0,
    lastCheckedAt,
    lastTested: lastCheckedAt,
  };
}

export function getCodexLiveQuotaSignal(connection, { statusCode, errorText, errorCode } = {}) {
  if (connection?.provider !== "codex") return null;
  if (statusCode !== 429) return null;

  const normalized = [errorText, errorCode]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .join(" ");

  if (!normalized || !CODEX_LIVE_QUOTA_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return null;
  }

  return {
    provider: "codex",
    kind: "quota_exhausted",
    reasonCode: "quota_exhausted",
    reasonDetail: "Codex quota exhausted",
    errorCode: "codex_live_quota_exhausted",
  };
}

export function getUsageStatusUpdates(connection, usage, options = {}) {
  const base = getHealthyUsageStatusUpdates(usage);
  const liveSignal = options.liveSignal || null;

  if (liveSignal?.kind === "quota_exhausted" && connection?.provider === "codex") {
    return {
      ...base,
      routingStatus: "blocked_quota",
      healthStatus: "degraded",
      quotaState: "exhausted",
      lastError: liveSignal.reasonDetail || "Codex quota exhausted",
      lastErrorType: liveSignal.reasonCode || "quota_exhausted",
      lastErrorAt: options.observedAt || new Date().toISOString(),
      rateLimitedUntil: liveSignal.resetAt || null,
      errorCode: liveSignal.errorCode || "codex_live_quota_exhausted",
      reasonCode: liveSignal.reasonCode || "quota_exhausted",
      reasonDetail: liveSignal.reasonDetail || "Codex quota exhausted",
      resetAt: liveSignal.resetAt || null,
      nextRetryAt: liveSignal.resetAt || null,
    };
  }

  if (connection?.provider !== "codex") {
    return base;
  }

  const sessionQuota = usage?.quotas?.session;
  const weeklyQuota = usage?.quotas?.weekly;
  const isWeeklyOnly = !sessionQuota && !!weeklyQuota;

  if (!isWeeklyOnly) {
    return base;
  }

  if ((weeklyQuota.remaining ?? 0) <= 0 || usage?.limitReached === true) {
    return {
      ...base,
      routingStatus: "blocked_quota",
      healthStatus: "degraded",
      quotaState: "exhausted",
      lastError: "Codex weekly quota exhausted",
      lastErrorType: "quota_exhausted",
      lastErrorAt: new Date().toISOString(),
      rateLimitedUntil: weeklyQuota.resetAt || null,
      errorCode: "weekly_quota_exhausted",
      reasonCode: "quota_exhausted",
      reasonDetail: "Codex weekly quota exhausted",
      resetAt: weeklyQuota.resetAt || null,
      nextRetryAt: weeklyQuota.resetAt || null,
    };
  }

  return base;
}

export async function applyCanonicalUsageRefresh(connection, usage, options = {}) {
  const updates = getUsageStatusUpdates(connection, usage, options);
  await syncUsageStatus(connection, updates);
  return updates;
}

export async function applyLiveQuotaUpdate(connection, signal, options = {}) {
  if (!connection?.id || !signal) return null;
  const updates = getUsageStatusUpdates(connection, null, {
    ...options,
    liveSignal: signal,
  });
  await syncUsageStatus(connection, updates);
  return updates;
}
