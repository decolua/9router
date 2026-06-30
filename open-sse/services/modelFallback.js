/**
 * Per-model fallback: a primary model string may name one fallback model.
 * On a fallback-eligible failure of the primary, the whole request is retried
 * once against the fallback. One hop only — no chaining, no recursion.
 */

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** True for upstream errors that retrying a different model will NOT fix
 *  (request payload too large / context length). Moved from chat.js. */
export function isDeterministicPayloadError(status, errorText) {
  if (status !== 400) return false;
  const text = typeof errorText === "string" ? errorText.toLowerCase() : "";
  return text.includes("content_length_exceeds_threshold") ||
    text.includes("input is too long") ||
    text.includes("context length") ||
    text.includes("maximum context") ||
    text.includes("too many tokens");
}

/**
 * Resolve the configured ordered fallback list for a primary model string.
 * Reads both the new ordered shape ({ fallbacks: [...] }) and the legacy
 * single-hop shape ({ fallback: "..." }) for back-compat.
 * @returns {string[]} ordered fallback model strings (empty if none/disabled)
 */
export function getModelFallbacks(primaryModelStr, modelFallbacks) {
  if (!isRecord(modelFallbacks)) return [];
  const entry = modelFallbacks[primaryModelStr];
  if (!isRecord(entry) || entry.enabled === false) return [];
  const list = Array.isArray(entry.fallbacks)
    ? entry.fallbacks
    : (entry.fallback ? [entry.fallback] : []);
  const seen = new Set([primaryModelStr]);
  const out = [];
  for (const f of list) {
    if (typeof f !== "string" || !f || seen.has(f)) continue;
    seen.add(f);
    out.push(f);
  }
  // Strategy: "ordered" (default), "random", "roundrobin"
  // Accept both new `strategy` field and legacy `mode` for back-compat.
  const strategy = entry.strategy || entry.mode || "ordered";
  // - ordered: preserve configured order
  // - random: Fisher-Yates shuffle on each resolve
  // - roundrobin: rotate starting index per resolve (one cursor per primary)
  if (strategy === "random" && out.length > 1) {
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
  } else if (strategy === "roundrobin" && out.length > 1) {
    const next = (ROUNDROBIN_CURSORS.get(primaryModelStr) ?? 0) % out.length;
    setRoundrobinCursor(primaryModelStr, (next + 1) % out.length);
    if (next > 0) {
      const head = out.slice(0, next);
      const tail = out.slice(next);
      out.length = 0;
      out.push(...tail, ...head);
    }
  }
  return out;
}

// Module-level cursor map for roundrobin mode. Keyed by primaryModelStr so
// each primary rotates independently. Capped (LRU) to prevent unbounded growth
// from deleted fallback rules; oldest entry evicted when the cap is exceeded.
const ROUNDROBIN_MAX_CURSORS = 500;
const ROUNDROBIN_CURSORS = new Map();

function setRoundrobinCursor(key, value) {
  // LRU: delete-then-set moves the key to insertion-order end (most recent).
  ROUNDROBIN_CURSORS.delete(key);
  ROUNDROBIN_CURSORS.set(key, value);
  if (ROUNDROBIN_CURSORS.size > ROUNDROBIN_MAX_CURSORS) {
    const oldestKey = ROUNDROBIN_CURSORS.keys().next().value;
    ROUNDROBIN_CURSORS.delete(oldestKey);
  }
}

/** Clear all roundrobin cursors — call when fallback settings are updated. */
export function resetRoundrobinCursors() {
  ROUNDROBIN_CURSORS.clear();
}

/** @deprecated alias — returns first fallback only. Use getModelFallbacks. */
export function getModelFallback(primaryModelStr, modelFallbacks) {
  return getModelFallbacks(primaryModelStr, modelFallbacks)[0] || null;
}

/**
 * Run `runner(modelStr)` for the primary; on a fallback-eligible failure, try
 * each fallback in order until one succeeds (or all fail). First-hop-only was
 * the old behavior; ordered list is the new behavior.
 * `runner` MUST resolve to a web Response.
 *
 * @param {string} primaryModelStr
 * @param {object} modelFallbacks
 * @param {function} runner
 * @param {object} [log]
 * @returns {Promise<Response>}
 */
export async function runWithModelFallback(primaryModelStr, modelFallbacks, runner, log) {
  const primaryResult = await runner(primaryModelStr);
  const fallbacks = getModelFallbacks(primaryModelStr, modelFallbacks);
  if (fallbacks.length === 0) return primaryResult;

  // Success fast-path: never read/buffer (covers streaming 2xx responses).
  if (primaryResult.status >= 200 && primaryResult.status < 300) return primaryResult;

  // Non-2xx here is a pre-stream buffered JSON error. Read defensively with a cap
  // so a malformed/hung body can never block the fallback decision.
  let errText = "";
  try {
    errText = await Promise.race([
      primaryResult.clone().text(),
      new Promise((resolve) => setTimeout(() => resolve(""), 200)),
    ]);
  } catch {
    errText = "";
  }

  // Skip fallback only for deterministic payload errors; every other non-2xx
  // (quota/rate-limit/auth/transient/unavailable) is eligible.
  if (isDeterministicPayloadError(primaryResult.status, errText)) return primaryResult;

  let lastFallbackResult = null;
  for (const fallback of fallbacks) {
    log?.warn?.("FALLBACK", `Primary "${primaryModelStr}" failed (${primaryResult.status}) → falling back to "${fallback}"`);
    try {
      const result = await runner(fallback);
      if (result.status >= 200 && result.status < 300) return result;
      lastFallbackResult = result;
      // Stop chain on deterministic payload errors: retrying a different
      // model will not fix a context-length / payload-too-large failure.
      let fbErrText = "";
      try {
        fbErrText = await Promise.race([
          result.clone().text(),
          new Promise((resolve) => setTimeout(() => resolve(""), 200)),
        ]);
      } catch { fbErrText = ""; }
      if (isDeterministicPayloadError(result.status, fbErrText)) return result;
    } catch (e) {
      // try next fallback — swallow runner exception
    }
  }
  // All fallbacks failed — return the last fallback's response so the client
  // sees the most recent upstream error (not the stale primary error).
  // Falls back to primaryResult only if every fallback threw.
  return lastFallbackResult || primaryResult;
}
