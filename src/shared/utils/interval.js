const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How far a reset interval reaches, in ms. "never" and anything unparseable stay 0.
 * Mirrors the quota check in src/lib/db/repos/apiKeysRepo.js.
 * @param {string} str - e.g. "30m", "5h", "7d", "never"
 * @returns {number} milliseconds, 0 when the key never resets
 */
export function parseIntervalMs(str) {
  if (!str || typeof str !== "string") return 0;
  const num = parseInt(str, 10);
  if (Number.isNaN(num) || num <= 0) return 0;
  if (str.endsWith("m")) return num * MINUTE_MS;
  if (str.endsWith("h")) return num * HOUR_MS;
  if (str.endsWith("d")) return num * DAY_MS;
  return 0;
}

/**
 * When the running quota window rolls over, based on the anchor lastResetAt.
 * Windows skipped while the key was idle are folded forward, so the due date
 * always lands in the future.
 * @param {string} resetInterval
 * @param {string|null} lastResetAt
 * @returns {string|null} ISO timestamp, or null when the key never resets
 */
export function nextResetAt(resetInterval, lastResetAt) {
  const span = parseIntervalMs(resetInterval);
  if (!span) return null;
  const anchor = lastResetAt ? new Date(lastResetAt).getTime() : 0;
  if (!anchor || Number.isNaN(anchor)) return null;
  const now = Date.now();
  let due = anchor + span;
  while (due <= now) due += span;
  return new Date(due).toISOString();
}

/**
 * Remaining time as a compact human string, e.g. "2d 3h 15m 42s" or "3h 15m 42s".
 * Leading zero units are dropped; seconds always show so a ticking display never
 * collapses to an empty string.
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  const totalSeconds = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}
