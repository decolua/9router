function getFutureTimestamp(value) {
  const timestamp = new Date(value).getTime();
  if (!value || !Number.isFinite(timestamp) || timestamp <= Date.now()) return null;
  return new Date(timestamp).toISOString();
}

export function getConnectionActiveModelLocks(connection = {}) {
  return Object.entries(connection || {})
    .filter(([key, value]) => key.startsWith("modelLock_") && getFutureTimestamp(value))
    .map(([key, value]) => ({
      key,
      model: key.slice("modelLock_".length) || "__all",
      until: getFutureTimestamp(value),
    }));
}

export function getConnectionCooldownUntil(connection = {}) {
  const timestamps = [
    getFutureTimestamp(connection?.nextRetryAt),
    getFutureTimestamp(connection?.rateLimitedUntil),
    getFutureTimestamp(connection?.resetAt),
    ...getConnectionActiveModelLocks(connection).map((lock) => lock.until),
  ].filter(Boolean);

  if (timestamps.length === 0) return null;
  return timestamps.sort()[0];
}

export function getConnectionProviderCooldownUntil(connection = {}) {
  const timestamps = [
    getFutureTimestamp(connection?.nextRetryAt),
    getFutureTimestamp(connection?.rateLimitedUntil),
    getFutureTimestamp(connection?.resetAt),
  ].filter(Boolean);

  if (timestamps.length === 0) return null;
  return timestamps.sort()[0];
}

function getCentralizedStatus(connection = {}) {
  switch (connection?.authState) {
    case "expired":
    case "invalid":
    case "revoked":
      return { status: "expired", source: "authState" };
    default:
      break;
  }

  switch (connection?.healthStatus) {
    case "error":
    case "failed":
    case "unhealthy":
    case "down":
      return { status: "error", source: "healthStatus" };
    default:
      break;
  }

  switch (connection?.quotaState) {
    case "exhausted":
    case "cooldown":
    case "blocked":
      return { status: "unavailable", source: "quotaState" };
    default:
      break;
  }

  switch (connection?.routingStatus) {
    case "blocked_auth":
      return { status: "expired", source: "routingStatus" };
    case "blocked_health":
      return { status: "error", source: "routingStatus" };
    case "blocked_quota":
    case "cooldown":
      return { status: "unavailable", source: "routingStatus" };
    case "eligible":
      return { status: "active", source: "routingStatus" };
    default:
      break;
  }

  if (connection?.quotaState === "ok") {
    return { status: "active", source: "quotaState" };
  }

  return null;
}

const CONNECTION_FILTER_STATUSES = new Set([
  "all",
  "eligible",
  "cooldown",
  "blocked_quota",
  "blocked_auth",
  "disabled",
  "unknown",
]);

const LEGACY_CONNECTION_FILTER_STATUS_MAP = {
  active: "eligible",
  "quota-exhausted": "blocked_quota",
  "revoked-invalid": "blocked_auth",
};

export function normalizeConnectionFilterStatus(value) {
  if (LEGACY_CONNECTION_FILTER_STATUS_MAP[value]) {
    return LEGACY_CONNECTION_FILTER_STATUS_MAP[value];
  }

  return CONNECTION_FILTER_STATUSES.has(value) ? value : "all";
}

export function getConnectionStatusDetails(connection) {
  if (!connection || typeof connection !== "object") {
    return {
      status: "unknown",
      source: "missing",
      hasActiveModelLock: false,
      cooldownUntil: null,
    };
  }

  const activeModelLocks = getConnectionActiveModelLocks(connection);
  const cooldownUntil = getConnectionCooldownUntil(connection);
  const centralized = getCentralizedStatus(connection);

  if (centralized) {
    return {
      status: centralized.status,
      source: centralized.source,
      hasActiveModelLock: activeModelLocks.length > 0,
      cooldownUntil,
      activeModelLocks,
    };
  }

  const status = connection.testStatus || "unknown";
  if (status === "unavailable" && activeModelLocks.length === 0 && !cooldownUntil) {
    return {
      status: "active",
      source: "legacy-unavailable-expired",
      hasActiveModelLock: false,
      cooldownUntil: null,
      activeModelLocks,
    };
  }

  return {
    status,
    source: connection.testStatus ? "legacy-testStatus" : "unknown",
    hasActiveModelLock: activeModelLocks.length > 0,
    cooldownUntil,
    activeModelLocks,
  };
}

export function getConnectionEffectiveStatus(connection) {
  return getConnectionStatusDetails(connection).status;
}

export function getConnectionCentralizedStatus(connection = {}) {
  if (!connection || typeof connection !== "object") return "unknown";
  if (connection.isActive === false) return "disabled";

  switch (connection.authState) {
    case "expired":
    case "invalid":
    case "revoked":
      return "blocked_auth";
    default:
      break;
  }

  switch (connection.healthStatus) {
    case "error":
    case "failed":
    case "unhealthy":
    case "down":
      return "blocked_health";
    default:
      break;
  }

  switch (connection.quotaState) {
    case "cooldown":
      return "cooldown";
    case "exhausted":
    case "blocked":
      return "blocked_quota";
    default:
      break;
  }

  switch (connection.routingStatus) {
    case "cooldown":
    case "blocked_quota":
    case "blocked_auth":
    case "blocked_health":
      return connection.routingStatus;
    case "eligible":
      return "eligible";
    default:
      break;
  }

  const details = getConnectionStatusDetails(connection);

  switch (details.status) {
    case "active":
    case "success":
      return "eligible";
    case "expired":
      return "blocked_auth";
    case "error":
      return "blocked_health";
    case "unavailable":
      return details.cooldownUntil ? "cooldown" : "blocked_quota";
    default:
      return "unknown";
  }
}

export function getConnectionFilterStatus(connection = {}) {
  const status = getConnectionCentralizedStatus(connection);
  return status === "blocked_health" ? "blocked_auth" : status;
}

export function getConnectionStatusBadgeMeta(connection = {}) {
  const status = getConnectionCentralizedStatus(connection);

  switch (status) {
    case "eligible":
      return { status, label: "Eligible", variant: "success" };
    case "cooldown":
      return { status, label: "Cooldown", variant: "warning" };
    case "blocked_quota":
      return { status, label: "Quota blocked", variant: "error" };
    case "blocked_auth":
      return { status, label: "Auth blocked", variant: "error" };
    case "blocked_health":
      return { status, label: "Health blocked", variant: "error" };
    case "disabled":
      return { status, label: "Disabled", variant: "default" };
    default:
      return { status: "unknown", label: "Unknown", variant: "default" };
  }
}
