// Per-API-key spend limit: pure helpers (no DB, no request objects), shared by
// the DB repo, the API routes and the engine.
import { KEY_LIMIT_WINDOW, KEY_LIMIT_WINDOWS, KEY_LIMIT_MAX_USD } from "@/shared/constants/keyAccess.js";

/**
 * Limit from the two apiKeys columns. A missing or corrupt value reads as NO
 * limit (the meter fails open, see keySpendLimit.js), never as a limit of 0.
 */
export function keyLimitFromColumns(usdCol, windowCol) {
  if (usdCol === null || usdCol === undefined) return null;
  const usd = Number(usdCol);
  if (!Number.isFinite(usd) || usd <= 0) return null;
  if (!KEY_LIMIT_WINDOWS.includes(windowCol)) return null;
  return { usd, window: windowCol };
}

/** Columns to persist for a limit (already validated), or both NULL. */
export function keyLimitToColumns(limit) {
  return limit ? { limitUsd: limit.usd, limitWindow: limit.window } : { limitUsd: null, limitWindow: null };
}

/**
 * Validate client input for a limit update: null clears it, otherwise
 * { usd, window }. Rejects rather than repairs.
 * @returns {{ ok: true, value: {usd: number, window: string} | null } | { ok: false, error: string }}
 */
export function validateKeyLimitInput(input) {
  if (input === null) return { ok: true, value: null };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "limit must be null or an object { usd, window }" };
  }
  const extra = Object.keys(input).filter((k) => k !== "usd" && k !== "window");
  if (extra.length) return { ok: false, error: `limit: unexpected field(s) ${extra.join(", ")}` };
  if (typeof input.usd !== "number" || !Number.isFinite(input.usd) || input.usd <= 0) {
    return { ok: false, error: "limit.usd must be a number greater than 0" };
  }
  if (input.usd > KEY_LIMIT_MAX_USD) {
    return { ok: false, error: `limit.usd must be at most ${KEY_LIMIT_MAX_USD}` };
  }
  if (!KEY_LIMIT_WINDOWS.includes(input.window)) {
    return { ok: false, error: `limit.window must be one of: ${KEY_LIMIT_WINDOWS.join(", ")}` };
  }
  return { ok: true, value: { usd: input.usd, window: input.window } };
}

/** Start (inclusive) of the current calendar day or month, UTC. */
export function windowStart(window, now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return new Date(window === KEY_LIMIT_WINDOW.MONTH ? Date.UTC(y, m, 1) : Date.UTC(y, m, now.getUTCDate()));
}

/** When the current window ends (the start of the next one), UTC. */
export function windowReset(window, now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return new Date(window === KEY_LIMIT_WINDOW.MONTH ? Date.UTC(y, m + 1, 1) : Date.UTC(y, m, now.getUTCDate() + 1));
}
