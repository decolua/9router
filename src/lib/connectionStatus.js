export function getConnectionEffectiveStatus(connection) {
  if (!connection || typeof connection !== "object") return "unknown";

  const hasActiveModelLock = Object.entries(connection).some(
    ([key, value]) =>
      key.startsWith("modelLock_") && value && new Date(value).getTime() > Date.now(),
  );

  const hasActiveRateLimit = Boolean(
    connection.rateLimitedUntil &&
      new Date(connection.rateLimitedUntil).getTime() > Date.now(),
  );

  if (
    connection.testStatus === "unavailable" &&
    !hasActiveModelLock &&
    !hasActiveRateLimit
  ) {
    return "active";
  }

  return connection.testStatus || "unknown";
}
