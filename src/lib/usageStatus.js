import { updateProviderConnection } from "@/lib/localDb";
import { projectLegacyConnectionState, writeConnectionHotState } from "@/lib/providerHotState";

const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];
const AUTH_BLOCKED_PATTERNS = [
  "token invalid",
  "invalid token",
  "token expired",
  "refresh failed",
  "re-authorize",
  "reauthorize",
  "sign in again",
  "unauthorized",
  "unauthenticated",
  "forbidden",
  "revoked",
  "expired",
  "401",
  "403",
];
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

export function isConfirmedAuthBlockedError(error, { statusCode = null } = {}) {
  if (statusCode === 401 || statusCode === 403) {
    return true;
  }

  const message = typeof error === "string"
    ? error
    : error?.message || error?.error || error?.cause?.message || "";

  if (!message) return false;

  const normalized = String(message).toLowerCase();
  return AUTH_BLOCKED_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function getConnectionAuthBlockedPatch(error, { lastCheckedAt = new Date().toISOString(), statusCode = null } = {}) {
  const message = typeof error === "string"
    ? error
    : error?.message || error?.error || error?.cause?.message || "";

  if (!isConfirmedAuthBlockedError(message, { statusCode })) {
    return null;
  }

  const reasonDetail = message || "Provider error";

  return {
    routingStatus: "blocked_auth",
    healthStatus: "healthy",
    quotaState: "ok",
    authState: "invalid",
    reasonCode: "auth_invalid",
    reasonDetail,
    nextRetryAt: null,
    resetAt: null,
    testStatus: "expired",
    lastError: reasonDetail,
    lastErrorType: "auth_invalid",
    lastErrorAt: lastCheckedAt,
    rateLimitedUntil: null,
    errorCode: "auth_invalid",
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

function getCodexExhaustedQuota(usage = {}) {
  const quotas = usage?.quotas;
  if (!quotas || typeof quotas !== "object") return null;

  for (const [quotaName, quota] of Object.entries(quotas)) {
    if (!quota || typeof quota !== "object") continue;

    const remaining = quota.remaining;
    const used = quota.used;
    const total = quota.total;

    const hasExhaustedRemaining = typeof remaining === "number" && remaining <= 0;
    const hasExhaustedTotal = typeof total === "number"
      && total > 0
      && typeof used === "number"
      && used >= total;

    if (hasExhaustedRemaining || hasExhaustedTotal) {
      return {
        quotaName,
        resetAt: quota.resetAt || null,
      };
    }
  }

  return null;
}

function getConfiguredMinimumRemainingQuotaPercent(connection = {}) {
  const rawValue = connection?.providerSpecificData?.minimumRemainingQuotaPercent;
  if (rawValue === null || rawValue === undefined || rawValue === "") return null;

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return null;

  return Math.max(0, Math.min(100, parsed));
}

function getSafeRemainingPercent(quota = {}) {
  if (!quota || typeof quota !== "object") return null;

  const explicitRemainingPercentage = quota.remainingPercentage;
  if (Number.isFinite(explicitRemainingPercentage) && explicitRemainingPercentage >= 0 && explicitRemainingPercentage <= 100) {
    return explicitRemainingPercentage;
  }

  const total = quota.total;
  const used = quota.used;

  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(used) || used < 0) return null;

  const remainingPercent = ((total - used) / total) * 100;
  if (!Number.isFinite(remainingPercent) || remainingPercent < 0 || remainingPercent > 100) {
    return null;
  }

  return remainingPercent;
}

function getKiroQuotaSignal(connection, usage = {}) {
  const quotas = usage?.quotas;
  if (!quotas || typeof quotas !== "object") return null;

  for (const [quotaName, quota] of Object.entries(quotas)) {
    if (!quota || typeof quota !== "object") continue;

    const total = quota.total;
    const used = quota.used;
    const remaining = quota.remaining;

    const hasExplicitExhaustion = typeof remaining === "number" && remaining <= 0;
    const hasUsedAllQuota = Number.isFinite(total)
      && total > 0
      && Number.isFinite(used)
      && used >= total;

    if (hasExplicitExhaustion || hasUsedAllQuota || usage?.limitReached === true || usage?.revoked === true) {
      return {
        kind: "exhausted",
        quotaName,
        resetAt: quota.resetAt || null,
      };
    }

    const minimumRemainingQuotaPercent = getConfiguredMinimumRemainingQuotaPercent(connection);
    if (minimumRemainingQuotaPercent === null) {
      continue;
    }

    const remainingPercent = getSafeRemainingPercent(quota);
    if (remainingPercent === null) {
      continue;
    }

    if (remainingPercent <= minimumRemainingQuotaPercent) {
      return {
        kind: "threshold",
        quotaName,
        resetAt: quota.resetAt || null,
        remainingPercent,
        minimumRemainingQuotaPercent,
      };
    }
  }

  if (usage?.limitReached === true || usage?.revoked === true) {
    return {
      kind: "exhausted",
      quotaName: null,
      resetAt: null,
    };
  }

  return null;
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
    if (connection?.provider === "kiro") {
      const kiroQuotaSignal = getKiroQuotaSignal(connection, usage);

      if (kiroQuotaSignal?.kind === "exhausted") {
        return {
          ...base,
          routingStatus: "blocked_quota",
          healthStatus: "degraded",
          quotaState: "exhausted",
          lastError: "Kiro quota exhausted",
          lastErrorType: "quota_exhausted",
          lastErrorAt: new Date().toISOString(),
          rateLimitedUntil: kiroQuotaSignal.resetAt || null,
          errorCode: "quota_exhausted",
          reasonCode: "quota_exhausted",
          reasonDetail: "Kiro quota exhausted",
          resetAt: kiroQuotaSignal.resetAt || null,
          nextRetryAt: kiroQuotaSignal.resetAt || null,
        };
      }

      if (kiroQuotaSignal?.kind === "threshold") {
        return {
          ...base,
          routingStatus: "blocked_quota",
          quotaState: "blocked",
          lastError: `Kiro remaining quota is at or below ${kiroQuotaSignal.minimumRemainingQuotaPercent}%`,
          lastErrorType: "quota_threshold",
          lastErrorAt: new Date().toISOString(),
          rateLimitedUntil: kiroQuotaSignal.resetAt || null,
          errorCode: "quota_threshold",
          reasonCode: "quota_threshold",
          reasonDetail: `Kiro remaining quota is at or below ${kiroQuotaSignal.minimumRemainingQuotaPercent}%`,
          resetAt: kiroQuotaSignal.resetAt || null,
          nextRetryAt: kiroQuotaSignal.resetAt || null,
        };
      }
    }

    return base;
  }

  const exhaustedQuota = getCodexExhaustedQuota(usage);

  if (exhaustedQuota || usage?.limitReached === true) {
    const quotaLabel = exhaustedQuota?.quotaName === "session"
      ? "session"
      : exhaustedQuota?.quotaName === "weekly"
        ? "weekly"
        : "quota";
    const reasonDetail = quotaLabel === "quota"
      ? "Codex quota exhausted"
      : `Codex ${quotaLabel} quota exhausted`;
    const errorCode = quotaLabel === "quota"
      ? "quota_exhausted"
      : `${quotaLabel}_quota_exhausted`;

    return {
      ...base,
      routingStatus: "blocked_quota",
      healthStatus: "degraded",
      quotaState: "exhausted",
      lastError: reasonDetail,
      lastErrorType: "quota_exhausted",
      lastErrorAt: new Date().toISOString(),
      rateLimitedUntil: exhaustedQuota?.resetAt || null,
      errorCode,
      reasonCode: "quota_exhausted",
      reasonDetail,
      resetAt: exhaustedQuota?.resetAt || null,
      nextRetryAt: exhaustedQuota?.resetAt || null,
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
