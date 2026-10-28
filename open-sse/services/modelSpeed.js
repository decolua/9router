/**
 * In-memory output speed (tokens/s) per provider/model, used by the "fastest"
 * combo strategy. Fed from finished responses; resets on restart.
 */

const SPEED_DEFAULTS = {
  minTokens: 20,            // shorter replies give noisy speeds
  minTimeMs: 300,           // shorter timing windows are noise (a stream that arrived in one go has none)
  smoothing: 0.3,           // weight of the newest sample in the rolling average
  staleMs: 10 * 60 * 1000,  // old speeds count as unmeasured so a once-slow model gets re-tried
};

// Streamed replies are timed from the first token (pure output speed), JSON replies
// over the whole request. The numbers aren't comparable, so each mode has its own score.
export const SPEED_MODE = { STREAM: "stream", JSON: "json" };

/** @type {Map<string, { tps?: number, updatedAt?: number, probedAt?: number }>} */
const speedState = new Map();

const speedKey = (provider, model, mode) => `${mode}:${provider}/${model}`;

const isFresh = (at) => !!at && Date.now() - at <= SPEED_DEFAULTS.staleMs;

/**
 * Whether the client gets a stream or one JSON reply. Mirrors chatCore's client-side
 * choice: body.stream, else the Accept header, else stream. Provider-side overrides
 * (e.g. forceStream) can still differ; such a model then just has no speed yet.
 * @param {Object} body - Request body
 * @param {Object} [headers] - Client headers (lowercase keys)
 * @returns {string} SPEED_MODE value
 */
export function getSpeedMode(body, headers) {
  if (body?.stream === true) return SPEED_MODE.STREAM;
  if (body?.stream === false) return SPEED_MODE.JSON;
  const accept = headers?.accept || "";
  return accept.includes("application/json") && !accept.includes("text/event-stream")
    ? SPEED_MODE.JSON
    : SPEED_MODE.STREAM;
}

/**
 * Record one finished response.
 * @param {string} provider
 * @param {string} model
 * @param {string} mode - SPEED_MODE value
 * @param {number} outputTokens - Completion/output tokens of the response
 * @param {{ ttft?: number, total: number }} latency - Milliseconds from request start (ttft needed for STREAM)
 */
export function recordModelSpeed(provider, model, mode, outputTokens, latency) {
  if (!provider || !model || !latency?.total) return;
  if (!(outputTokens >= SPEED_DEFAULTS.minTokens)) return;

  const ms = mode === SPEED_MODE.STREAM ? latency.total - latency.ttft : latency.total;
  if (!(ms >= SPEED_DEFAULTS.minTimeMs)) return;
  const tps = outputTokens / (ms / 1000);

  const key = speedKey(provider, model, mode);
  const prev = getModelSpeed(provider, model, mode);
  speedState.set(key, {
    ...speedState.get(key),
    tps: prev === null ? tps : prev + SPEED_DEFAULTS.smoothing * (tps - prev),
    updatedAt: Date.now(),
  });
}

/**
 * @returns {number|null} Average tokens/s, or null when unmeasured or stale
 */
export function getModelSpeed(provider, model, mode) {
  const entry = speedState.get(speedKey(provider, model, mode));
  return isFresh(entry?.updatedAt) ? entry.tps : null;
}

/**
 * Mark that an unmeasured model was given its test turn. It gets one per stale
 * window, so a model whose replies are short (or fail) can't stay in front.
 */
export function markModelProbed(provider, model, mode) {
  const key = speedKey(provider, model, mode);
  speedState.set(key, { ...speedState.get(key), probedAt: Date.now() });
}

export function wasProbedRecently(provider, model, mode) {
  return isFresh(speedState.get(speedKey(provider, model, mode))?.probedAt);
}

export function resetModelSpeeds() {
  speedState.clear();
}
