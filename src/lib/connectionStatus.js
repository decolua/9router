function getFutureTimestamp(value) {
  const timestamp = new Date(value).getTime();
  if (!value || !Number.isFinite(timestamp) || timestamp <= Date.now()) return null;
  return new Date(timestamp).toISOString();
}

export function getConnectionActiveModelLocks(connection = {}) {
  return Object.entries(connection || {}).reduce((locks, [key, value]) => {
    if (!key.startsWith("modelLock_")) return locks;

    const until = getFutureTimestamp(value);
    if (!until) return locks;

    locks.push({
      key,
      model: key.slice("modelLock_".length) || "__all",
      until,
    });

    return locks;
  }, []);
}

export function getConnectionCooldownUntil(connection = {}) {
  const timestamps = [
    getFutureTimestamp(connection?.nextRetryAt),
    getFutureTimestamp(connection?.resetAt),
    ...getConnectionActiveModelLocks(connection).map((lock) => lock.until),
  ].filter(Boolean);

  if (timestamps.length === 0) return null;
  return timestamps.sort()[0];
}

export function getConnectionProviderCooldownUntil(connection = {}) {
  const timestamps = [
    getFutureTimestamp(connection?.nextRetryAt),
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
      return { status: "blocked", source: "authState" };
    default:
      break;
  }

  switch (connection?.healthStatus) {
    case "error":
    case "failed":
    case "unhealthy":
    case "down":
      return { status: "blocked", source: "healthStatus" };
    default:
      break;
  }

  switch (connection?.quotaState) {
    case "exhausted":
    case "blocked":
      return { status: "exhausted", source: "quotaState" };
    case "ok":
      if (connection?.authState === "ok" && connection?.healthStatus === "healthy") {
        return { status: "eligible", source: "quotaState" };
      }
      break;
    default:
      break;
  }

  switch (connection?.routingStatus) {
    case "eligible":
    case "exhausted":
    case "blocked":
    case "unknown":
    case "disabled":
      return { status: connection.routingStatus, source: "routingStatus" };
    default:
      break;
  }

  return null;
}

const CONNECTION_FILTER_STATUSES = new Set([
  "all",
  "eligible",
  "exhausted",
  "blocked",
  "disabled",
  "unknown",
]);

export function normalizeConnectionFilterStatus(value) {
  return CONNECTION_FILTER_STATUSES.has(value) ? value : "all";
}

export function getConnectionStatusDetails(connection) {
  if (!connection || typeof connection !== "object") {
    return {
      status: "unknown",
      source: "missing",
      hasActiveModelLock: false,
      cooldownUntil: null,
      activeModelLocks: [],
    };
  }

  if (connection.isActive === false) {
    return {
      status: "disabled",
      source: "isActive",
      hasActiveModelLock: false,
      cooldownUntil: null,
      activeModelLocks: [],
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

  return {
    status: "unknown",
    source: "unknown",
    hasActiveModelLock: activeModelLocks.length > 0,
    cooldownUntil,
    activeModelLocks,
  };
}

export function getConnectionEffectiveStatus(connection) {
  return getConnectionStatusDetails(connection).status;
}

export function getConnectionCentralizedStatus(connection = {}) {
  const details = getConnectionStatusDetails(connection);
  return details.status;
}

export function getConnectionFilterStatus(connection = {}) {
  const status = getConnectionCentralizedStatus(connection);

  switch (status) {
    case "eligible":
      return "eligible";
    case "exhausted":
      return "exhausted";
    case "blocked":
      return "blocked";
    case "disabled":
      return "disabled";
    default:
      return "unknown";
  }
}

export function getConnectionStatusBadgeMeta(connection = {}) {
  const status = getConnectionCentralizedStatus(connection);

  switch (status) {
    case "eligible":
      return { status, label: "Eligible", variant: "success" };
    case "exhausted":
      return { status, label: "Exhausted", variant: "warning" };
    case "blocked":
      return { status, label: "Blocked", variant: "error" };
    case "disabled":
      return { status, label: "Disabled", variant: "default" };
    default:
      return { status: "unknown", label: "Unknown", variant: "default" };
  }
}
