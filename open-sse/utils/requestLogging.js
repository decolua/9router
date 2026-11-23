/**
 * Read the process-level request logging override.
 *
 * An unset variable preserves the caller's existing default. Any configured
 * value is explicit: only a trimmed, case-insensitive "true" enables logs.
 */
export function getRequestLoggingEnv() {
  const raw = typeof process !== "undefined" ? process.env?.ENABLE_REQUEST_LOGS : undefined;
  if (raw === undefined) return { configured: false, enabled: false };
  return { configured: true, enabled: String(raw).trim().toLowerCase() === "true" };
}

/**
 * Resolve request logging with a caller-specific default when the env override
 * is absent. Console output defaults on; deep request files default off.
 */
export function isRequestLoggingEnabled(defaultEnabled = true) {
  const env = getRequestLoggingEnv();
  return env.configured ? env.enabled : defaultEnabled;
}
