const REFRESH_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_HOURLY_LIMIT = 1;
const MIN_HOURLY_LIMIT = 1;
const MAX_HOURLY_LIMIT = 10;
const DEFAULT_THRESHOLD_PERCENT = 5;

function asProviderSpecificData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  if (value.providerSpecificData && typeof value.providerSpecificData === "object") {
    return value.providerSpecificData;
  }
  return value;
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function clampInteger(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback));
}

function normalizeIso(value, fallbackMs = Date.now()) {
  const parsed = typeof value === "string" ? new Date(value).getTime() : Number(value);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return new Date(fallbackMs).toISOString();
}

function normalizeReason(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "unknown";
}

function normalizeEvents(events) {
  if (!Array.isArray(events)) return [];
  return events
    .map((event) => {
      const atMs = new Date(event?.at).getTime();
      if (!Number.isFinite(atMs)) return null;
      return {
        at: new Date(atMs).toISOString(),
        reason: normalizeReason(event?.reason),
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

function trimEvents(events, nowMs) {
  return normalizeEvents(events).filter((event) => {
    const eventMs = new Date(event.at).getTime();
    return eventMs + REFRESH_WINDOW_MS > nowMs;
  });
}

function normalizeQuotaEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const remaining = Number(entry.remaining);
  if (!Number.isFinite(remaining)) return null;
  return {
    remaining: Math.max(0, Math.min(100, remaining)),
    resetAt: typeof entry.resetAt === "string" && entry.resetAt ? entry.resetAt : null,
  };
}

export function normalizeCodexGoRefreshConfig(value = {}) {
  const providerSpecificData = asProviderSpecificData(value);
  const raw = providerSpecificData.codexGoRefreshConfig || {};
  return {
    hourlyLimit: clampInteger(raw.hourlyLimit, MIN_HOURLY_LIMIT, MAX_HOURLY_LIMIT, DEFAULT_HOURLY_LIMIT),
    autoEnabled: raw.autoEnabled === true,
    thresholdRemainingPercent: clampNumber(
      raw.thresholdRemainingPercent,
      0,
      100,
      DEFAULT_THRESHOLD_PERCENT,
    ),
  };
}

export function getCodexGoRefreshWindow(value = {}, nowMs = Date.now()) {
  const providerSpecificData = asProviderSpecificData(value);
  const config = normalizeCodexGoRefreshConfig(providerSpecificData);
  const events = trimEvents(providerSpecificData.codexGoRefreshState?.events, nowMs);
  const used = events.length;
  const remaining = Math.max(0, config.hourlyLimit - used);
  const exhausted = remaining <= 0;
  const nextEventIndex = exhausted ? Math.max(0, used - config.hourlyLimit) : -1;
  const nextRefreshAt = exhausted && events.length > 0
    ? new Date(new Date(events[nextEventIndex].at).getTime() + REFRESH_WINDOW_MS).toISOString()
    : null;

  return {
    used,
    limit: config.hourlyLimit,
    remaining,
    exhausted,
    nextRefreshAt,
    events,
  };
}

export function getCodexGoRefreshState(value = {}, nowMs = Date.now()) {
  const providerSpecificData = asProviderSpecificData(value);
  const state = providerSpecificData.codexGoRefreshState || {};
  return {
    events: trimEvents(state.events, nowMs),
    lastRefreshAt: typeof state.lastRefreshAt === "string" ? state.lastRefreshAt : null,
    lastRefreshReason: typeof state.lastRefreshReason === "string" ? state.lastRefreshReason : null,
    lastQuotaSnapshot: state.lastQuotaSnapshot || null,
    lastError: state.lastError || null,
  };
}

export function getCodexGoRefreshMeta(value = {}, nowMs = Date.now()) {
  const providerSpecificData = asProviderSpecificData(value);
  return {
    config: normalizeCodexGoRefreshConfig(providerSpecificData),
    window: getCodexGoRefreshWindow(providerSpecificData, nowMs),
    state: getCodexGoRefreshState(providerSpecificData, nowMs),
  };
}

export function canUseCodexGoRefresh(value = {}, nowMs = Date.now()) {
  const window = getCodexGoRefreshWindow(value, nowMs);
  return {
    ok: !window.exhausted,
    ...window,
  };
}

export function recordCodexGoRefresh(value = {}, reason = "manual", at = new Date().toISOString(), quotaSnapshot = undefined) {
  const providerSpecificData = asProviderSpecificData(value);
  const atIso = normalizeIso(at);
  const atMs = new Date(atIso).getTime();
  const previousState = providerSpecificData.codexGoRefreshState || {};
  const events = trimEvents([
    ...(Array.isArray(previousState.events) ? previousState.events : []),
    { at: atIso, reason: normalizeReason(reason) },
  ], atMs);

  return {
    ...providerSpecificData,
    codexGoRefreshConfig: normalizeCodexGoRefreshConfig(providerSpecificData),
    codexGoRefreshState: {
      ...previousState,
      events,
      lastRefreshAt: atIso,
      lastRefreshReason: normalizeReason(reason),
      lastQuotaSnapshot: quotaSnapshot === undefined ? (previousState.lastQuotaSnapshot || null) : quotaSnapshot,
      lastError: null,
    },
  };
}

export function recordCodexGoRefreshError(value = {}, error, at = new Date().toISOString(), quotaSnapshot = undefined) {
  const providerSpecificData = asProviderSpecificData(value);
  const previousState = providerSpecificData.codexGoRefreshState || {};
  const atIso = normalizeIso(at);
  return {
    ...providerSpecificData,
    codexGoRefreshConfig: normalizeCodexGoRefreshConfig(providerSpecificData),
    codexGoRefreshState: {
      ...previousState,
      events: trimEvents(previousState.events, new Date(atIso).getTime()),
      lastQuotaSnapshot: quotaSnapshot === undefined ? (previousState.lastQuotaSnapshot || null) : quotaSnapshot,
      lastError: {
        message: error?.message || String(error || "CodexGo refresh failed"),
        at: atIso,
      },
    },
  };
}

export function recordCodexGoQuotaSnapshot(value = {}, quotaSnapshot, at = new Date().toISOString()) {
  const providerSpecificData = asProviderSpecificData(value);
  const previousState = providerSpecificData.codexGoRefreshState || {};
  const atIso = normalizeIso(at);
  return {
    ...providerSpecificData,
    codexGoRefreshConfig: normalizeCodexGoRefreshConfig(providerSpecificData),
    codexGoRefreshState: {
      ...previousState,
      events: trimEvents(previousState.events, new Date(atIso).getTime()),
      lastQuotaSnapshot: quotaSnapshot || null,
      lastError: null,
    },
  };
}

export function getCodexGoQuotaSnapshot(usage, checkedAt = new Date().toISOString()) {
  const checkedAtIso = normalizeIso(checkedAt);
  return {
    session: normalizeQuotaEntry(usage?.quotas?.session),
    weekly: normalizeQuotaEntry(usage?.quotas?.weekly),
    checkedAt: checkedAtIso,
  };
}

export function shouldAutoRefreshCodexGoFromSnapshot(snapshot, thresholdRemainingPercent = DEFAULT_THRESHOLD_PERCENT) {
  const threshold = clampNumber(thresholdRemainingPercent, 0, 100, DEFAULT_THRESHOLD_PERCENT);
  return [snapshot?.session, snapshot?.weekly].some((entry) => (
    entry && Number.isFinite(Number(entry.remaining)) && Number(entry.remaining) <= threshold
  ));
}

export function formatCodexGoRefreshReason(reason) {
  if (reason === "upstream_429") return "429";
  if (reason === "auto_threshold") return "auto";
  if (reason === "manual") return "manual";
  return reason || "unknown";
}

export function getCodexGoRefreshPolicyConstants() {
  return {
    refreshWindowMs: REFRESH_WINDOW_MS,
    defaultHourlyLimit: DEFAULT_HOURLY_LIMIT,
    maxHourlyLimit: MAX_HOURLY_LIMIT,
    defaultThresholdPercent: DEFAULT_THRESHOLD_PERCENT,
  };
}
