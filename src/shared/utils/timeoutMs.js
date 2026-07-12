// shared parse helpers for request timeout UI/API
export const DEFAULT_CONNECT_TIMEOUT_SECONDS = 60;

export function timeoutMsToSeconds(timeoutMs) {
  const n = Number(timeoutMs);
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(Math.round(n / 1000));
}

/** @returns {number|null} ms, or null when empty/invalid (use default) */
export function parseTimeoutSeconds(value) {
  const raw = typeof value === "string" ? value.trim() : value;
  if (raw === "" || raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000);
}

/** Normalize body.timeoutMs / body.timeoutSeconds → positive ms or null */
export function normalizeTimeoutMs(body = {}) {
  if (body.timeoutMs !== undefined) {
    if (body.timeoutMs === null || body.timeoutMs === "") return null;
    const n = Number(body.timeoutMs);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  if (body.timeoutSeconds !== undefined) {
    return parseTimeoutSeconds(body.timeoutSeconds);
  }
  return undefined; // field not provided
}
