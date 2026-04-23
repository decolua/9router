export const QUOTA_SCHEDULER_DEFAULTS = {
  enabled: true,
  cadenceMs: 900000,
  successTtlMs: 900000,
  errorTtlMs: 300000,
  exhaustedTtlMs: 60000,
  batchSize: 25,
};

const MIN_QUOTA_SCHEDULER_CADENCE_MS = 900000;
const MIN_QUOTA_SCHEDULER_BATCH_SIZE = 1;

function normalizeBoolean(value, fallback) {
  if (value === undefined) return fallback;
  return value === true;
}

function normalizeNonNegativeInteger(value, fallback, minimum = 0) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.trunc(value));
}

function normalizeCadenceMs(value) {
  const normalized = normalizeNonNegativeInteger(value, QUOTA_SCHEDULER_DEFAULTS.cadenceMs, MIN_QUOTA_SCHEDULER_CADENCE_MS);
  return Math.max(MIN_QUOTA_SCHEDULER_CADENCE_MS, normalized);
}

const DUE_REASON_PRIORITY = {
  quota_reset_due: 0,
  never_checked: 1,
  stale_error: 2,
  stale_success: 3,
  stale_unknown: 4,
  waiting_for_retry: 5,
  fresh_success: 6,
  fresh_unknown: 7,
  fresh_error: 8,
  scheduler_disabled: 9,
  unsupported: 10,
};

function toTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function toIso(value) {
  const timestamp = toTimestamp(value);
  return timestamp === null ? null : new Date(timestamp).toISOString();
}

function getMergedSchedulerSettings(schedulerSettings = {}) {
  const merged = {
    ...QUOTA_SCHEDULER_DEFAULTS,
    ...(schedulerSettings && typeof schedulerSettings === "object" && !Array.isArray(schedulerSettings)
      ? schedulerSettings
      : {}),
  };

  merged.enabled = normalizeBoolean(merged.enabled, QUOTA_SCHEDULER_DEFAULTS.enabled);
  merged.cadenceMs = normalizeCadenceMs(merged.cadenceMs);
  merged.successTtlMs = normalizeNonNegativeInteger(merged.successTtlMs, QUOTA_SCHEDULER_DEFAULTS.successTtlMs);
  merged.errorTtlMs = normalizeNonNegativeInteger(merged.errorTtlMs, QUOTA_SCHEDULER_DEFAULTS.errorTtlMs);
  merged.exhaustedTtlMs = normalizeNonNegativeInteger(merged.exhaustedTtlMs, QUOTA_SCHEDULER_DEFAULTS.exhaustedTtlMs);
  merged.batchSize = normalizeNonNegativeInteger(
    merged.batchSize,
    QUOTA_SCHEDULER_DEFAULTS.batchSize,
    MIN_QUOTA_SCHEDULER_BATCH_SIZE
  );

  return merged;
}

function isQuotaBlockedState(hotState = {}) {
  const routingStatus = hotState?.routingStatus || null;
  const quotaState = hotState?.quotaState || null;
  const reasonCode = hotState?.reasonCode || null;

  return routingStatus === "exhausted"
    || (routingStatus === "blocked" && reasonCode === "quota_exhausted")
    || quotaState === "exhausted"
    || quotaState === "blocked";
}

function isErrorState(hotState = {}) {
  const routingStatus = hotState?.routingStatus || null;
  const reasonCode = hotState?.reasonCode || null;
  const healthStatus = hotState?.healthStatus || null;

  return (routingStatus === "blocked" && reasonCode !== "quota_exhausted")
    || ["error", "failed", "down", "unhealthy"].includes(healthStatus);
}

function getRetryGate(hotState = {}) {
  const resetAtTs = toTimestamp(hotState?.resetAt);
  const retryCandidates = [hotState.nextRetryAt, hotState.resetAt]
    .map(toTimestamp)
    .filter((value) => value !== null);

  if (retryCandidates.length === 0) return null;

  if (isQuotaBlockedState(hotState)) {
    if (resetAtTs !== null) return resetAtTs;
    return Math.max(...retryCandidates);
  }

  return Math.min(...retryCandidates);
}

function getDecisionTtlMs(hotState = {}, schedulerSettings) {
  const quotaState = hotState?.quotaState || null;
  const routingStatus = hotState?.routingStatus || null;

  if (isQuotaBlockedState(hotState)) {
    return schedulerSettings.exhaustedTtlMs;
  }

  if (isErrorState(hotState)) {
    return Math.max(schedulerSettings.errorTtlMs, schedulerSettings.cadenceMs);
  }

  if (routingStatus === "eligible" || quotaState === "ok") {
    return Math.max(schedulerSettings.successTtlMs, schedulerSettings.cadenceMs);
  }

  return schedulerSettings.cadenceMs;
}

function isSuccessLikeState(hotState = {}) {
  const routingStatus = hotState?.routingStatus || null;
  const quotaState = hotState?.quotaState || null;

  return routingStatus === "eligible" || quotaState === "ok";
}

function getFreshReason(hotState = {}) {
  if (isErrorState(hotState)) return "fresh_error";
  if (isSuccessLikeState(hotState)) return "fresh_success";
  return "fresh_unknown";
}

function getStaleReason(hotState = {}) {
  if (isErrorState(hotState)) return "stale_error";
  if (isSuccessLikeState(hotState)) return "stale_success";
  return "stale_unknown";
}

export function isQuotaRefreshSupported(connection = {}) {
  return connection?.provider === "codex"
    && connection?.authType === "oauth"
    && connection?.isActive !== false;
}

export function getQuotaRefreshDecision({ connection = {}, schedulerSettings = {}, hotState = {}, now = new Date().toISOString() } = {}) {
  const mergedSettings = getMergedSchedulerSettings(schedulerSettings);
  const nowTs = toTimestamp(now) ?? Date.now();

  if (!mergedSettings.enabled) {
    return { due: false, reason: "scheduler_disabled", nextEligibleAt: null };
  }

  if (!isQuotaRefreshSupported(connection)) {
    return { due: false, reason: "unsupported", nextEligibleAt: null };
  }

  const lastCheckedTs = toTimestamp(hotState?.lastCheckedAt);
  const retryGateTs = getRetryGate(hotState);

  if (lastCheckedTs === null) {
    return { due: true, reason: "never_checked", nextEligibleAt: null, lastCheckedAt: null };
  }

  if (isQuotaBlockedState(hotState) && retryGateTs !== null) {
    if (retryGateTs > nowTs) {
      return {
        due: false,
        reason: "waiting_for_retry",
        nextEligibleAt: new Date(retryGateTs).toISOString(),
        lastCheckedAt: new Date(lastCheckedTs).toISOString(),
      };
    }

    return {
      due: true,
      reason: "quota_reset_due",
      nextEligibleAt: null,
      lastCheckedAt: new Date(lastCheckedTs).toISOString(),
    };
  }

  const ttlMs = getDecisionTtlMs(hotState, mergedSettings);
  const nextEligibleTs = lastCheckedTs + ttlMs;
  if (nextEligibleTs > nowTs) {
    return {
      due: false,
      reason: getFreshReason(hotState),
      nextEligibleAt: new Date(nextEligibleTs).toISOString(),
      lastCheckedAt: new Date(lastCheckedTs).toISOString(),
    };
  }

  return {
    due: true,
    reason: getStaleReason(hotState),
    nextEligibleAt: null,
    lastCheckedAt: new Date(lastCheckedTs).toISOString(),
  };
}

export function getQuotaRefreshSortKey(entry = {}) {
  const decision = entry?.decision || {};
  const connection = entry?.connection || {};
  const lastCheckedTs = toTimestamp(decision.lastCheckedAt) ?? Number.NEGATIVE_INFINITY;
  const nextEligibleTs = toTimestamp(decision.nextEligibleAt) ?? Number.POSITIVE_INFINITY;
  const reasonRank = DUE_REASON_PRIORITY[decision.reason] ?? 99;
  const priority = Number.isFinite(connection.priority) ? connection.priority : Number.MAX_SAFE_INTEGER;
  const id = connection.id || "";

  return [decision.due ? 0 : 1, reasonRank, lastCheckedTs, nextEligibleTs, priority, id];
}

export function sortQuotaRefreshCandidates(entries = []) {
  return [...entries].sort((left, right) => {
    const leftKey = getQuotaRefreshSortKey(left);
    const rightKey = getQuotaRefreshSortKey(right);

    for (let index = 0; index < Math.max(leftKey.length, rightKey.length); index += 1) {
      if (leftKey[index] < rightKey[index]) return -1;
      if (leftKey[index] > rightKey[index]) return 1;
    }

    return 0;
  });
}

export function planQuotaRefreshCandidates({ connections = [], schedulerSettings = {}, hotStateByConnectionId = {}, now } = {}) {
  return sortQuotaRefreshCandidates(connections.map((connection) => ({
    connection,
    decision: getQuotaRefreshDecision({
      connection,
      schedulerSettings,
      hotState: hotStateByConnectionId?.[connection.id] || {},
      now,
    }),
  })));
}

export function normalizeQuotaSchedulerSettings(settings = {}) {
  return getMergedSchedulerSettings(settings);
}

export function getQuotaRefreshNextEligibleAt(hotState = {}, schedulerSettings = {}, now = new Date().toISOString()) {
  return getQuotaRefreshDecision({
    connection: { provider: "codex", authType: "oauth", isActive: true },
    schedulerSettings: { ...getMergedSchedulerSettings(schedulerSettings), enabled: true },
    hotState,
    now,
  }).nextEligibleAt;
}

export function getQuotaRefreshRetryGate(hotState = {}) {
  return toIso(getRetryGate(hotState));
}
