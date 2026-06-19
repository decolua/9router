/**
 * Per-model fallback: a primary model string may name one fallback model.
 * On a fallback-eligible failure of the primary, the whole request is retried
 * once against the fallback. One hop only — no chaining, no recursion.
 */

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
 * Resolve the configured fallback for a primary model string.
 * @returns {string|null} fallback model string, or null if none/disabled/self
 */
export function getModelFallback(primaryModelStr, modelFallbacks) {
  if (!modelFallbacks || typeof modelFallbacks !== "object") return null;
  const entry = modelFallbacks[primaryModelStr];
  if (!entry || entry.enabled === false || !entry.fallback) return null;
  if (entry.fallback === primaryModelStr) return null; // self-fallback no-op
  return entry.fallback;
}

/**
 * Run `runner(modelStr)` for the primary; on a fallback-eligible failure, run it
 * once more for the configured fallback model and return that response.
 * `runner` MUST resolve to a web Response.
 * @param {string} primaryModelStr
 * @param {object} modelFallbacks - settings.modelFallbacks
 * @param {(modelStr: string) => Promise<Response>} runner
 * @param {{ warn?: Function }} [log]
 * @returns {Promise<Response>}
 */
export async function runWithModelFallback(primaryModelStr, modelFallbacks, runner, log) {
  const primaryResult = await runner(primaryModelStr);

  const fallback = getModelFallback(primaryModelStr, modelFallbacks);
  if (!fallback) return primaryResult;

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

  log?.warn?.("FALLBACK", `Primary "${primaryModelStr}" failed (${primaryResult.status}) → falling back to "${fallback}"`);
  return runner(fallback);
}
