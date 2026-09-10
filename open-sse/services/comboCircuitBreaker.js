const STATE_KEY = "__9routerComboModelCircuitBreakerState";

export const CIRCUIT_STATE = Object.freeze({
  CLOSED: "closed",
  OPEN: "open",
  HALF_OPEN: "half-open",
});

export const COMBO_CIRCUIT_DEFAULTS = Object.freeze({
  failureThreshold: 3,
  slowResponseThresholdMs: 30_000,
  openDurationMs: 60_000,
  unsupportedModelCooldownMs: 5 * 60_000,
  maxOpenDurationMs: 15 * 60_000,
  firstEventTimeoutMs: 30_000,
});

function stateStore() {
  if (!globalThis[STATE_KEY]) globalThis[STATE_KEY] = new Map();
  return globalThis[STATE_KEY];
}

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function freshState(model) {
  return {
    model,
    state: CIRCUIT_STATE.CLOSED,
    consecutiveFailures: 0,
    openCount: 0,
    probeInFlight: false,
    lastReason: null,
    lastStatus: null,
    lastLatencyMs: null,
    lastFailureAt: null,
    lastSuccessAt: null,
    lastStateChangeAt: nowIso(),
    nextProbeAt: null,
  };
}

function getMutableState(model) {
  const store = stateStore();
  if (!store.has(model)) store.set(model, freshState(model));
  return store.get(model);
}

function publicState(state) {
  return { ...state };
}

export function getComboCircuitState(model) {
  return publicState(getMutableState(model));
}

export function getComboCircuitSnapshot({ includeClosed = false } = {}) {
  return [...stateStore().values()]
    .filter((entry) => includeClosed || entry.state !== CIRCUIT_STATE.CLOSED)
    .map(publicState)
    .sort((a, b) => a.model.localeCompare(b.model));
}

export function getComboCircuitConfig() {
  return { ...COMBO_CIRCUIT_DEFAULTS };
}

export function clearComboCircuitBreakerState() {
  stateStore().clear();
}

export function resetComboCircuitBreaker(model) {
  stateStore().set(model, freshState(model));
  return getComboCircuitState(model);
}

function computeBackoffMs(state, requestedCooldownMs, unsupportedModel) {
  const base = Math.max(
    requestedCooldownMs || COMBO_CIRCUIT_DEFAULTS.openDurationMs,
    unsupportedModel ? COMBO_CIRCUIT_DEFAULTS.unsupportedModelCooldownMs : 0,
  );
  const multiplier = 2 ** Math.min(Math.max(state.openCount - 1, 0), 4);
  return Math.min(base * multiplier, COMBO_CIRCUIT_DEFAULTS.maxOpenDurationMs);
}

export function beginComboModelAttempt(model, now = Date.now()) {
  const state = getMutableState(model);

  if (state.state === CIRCUIT_STATE.CLOSED) {
    return { allowed: true, halfOpen: false, state: publicState(state) };
  }

  if (state.state === CIRCUIT_STATE.HALF_OPEN) {
    return { allowed: false, halfOpen: false, reason: "probe-in-flight", state: publicState(state) };
  }

  const nextProbeMs = state.nextProbeAt ? new Date(state.nextProbeAt).getTime() : 0;
  if (nextProbeMs > now) {
    return { allowed: false, halfOpen: false, reason: "circuit-open", state: publicState(state) };
  }

  state.state = CIRCUIT_STATE.HALF_OPEN;
  state.probeInFlight = true;
  state.lastStateChangeAt = nowIso(now);
  return { allowed: true, halfOpen: true, reason: "recovery-probe", state: publicState(state) };
}

export function recordComboModelSuccess(model, { latencyMs = null, now = Date.now() } = {}) {
  const state = getMutableState(model);
  state.state = CIRCUIT_STATE.CLOSED;
  state.consecutiveFailures = 0;
  state.openCount = 0;
  state.probeInFlight = false;
  state.lastReason = null;
  state.lastStatus = 200;
  state.lastLatencyMs = latencyMs;
  state.lastSuccessAt = nowIso(now);
  state.lastStateChangeAt = nowIso(now);
  state.nextProbeAt = null;
  return publicState(state);
}

export function recordComboModelFailure(model, {
  reason = "upstream_failure",
  status = null,
  latencyMs = null,
  retryAfterMs = null,
  immediate = false,
  now = Date.now(),
} = {}) {
  const state = getMutableState(model);
  const unsupportedModel = reason === "unsupported_model";

  state.consecutiveFailures += 1;
  state.probeInFlight = false;
  state.lastReason = reason;
  state.lastStatus = status;
  state.lastLatencyMs = latencyMs;
  state.lastFailureAt = nowIso(now);

  const shouldOpen = state.state === CIRCUIT_STATE.HALF_OPEN
    || immediate
    || state.consecutiveFailures >= COMBO_CIRCUIT_DEFAULTS.failureThreshold;

  if (!shouldOpen) return publicState(state);

  state.state = CIRCUIT_STATE.OPEN;
  state.openCount += 1;
  state.lastStateChangeAt = nowIso(now);
  const cooldownMs = computeBackoffMs(state, retryAfterMs, unsupportedModel);
  state.nextProbeAt = nowIso(now + cooldownMs);
  return publicState(state);
}

export function parseRetryAfterMs(response, now = Date.now()) {
  const raw = response?.headers?.get?.("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = new Date(raw).getTime();
  return Number.isFinite(dateMs) && dateMs > now ? dateMs - now : null;
}

export function classifyComboFailure(status, errorText = "") {
  const text = String(errorText || "").toLowerCase();
  if (
    text.includes("model") && (
      text.includes("not supported")
      || text.includes("unsupported")
      || text.includes("not found")
      || text.includes("does not exist")
    )
  ) {
    return { reason: "unsupported_model", immediate: true };
  }
  if (status === 429 || status === 402) return { reason: "rate_limited", immediate: true };
  if (status === 502 || status === 503 || status === 504) return { reason: "upstream_unavailable", immediate: false };
  if (status >= 500) return { reason: "upstream_error", immediate: false };
  return { reason: `http_${status || "error"}`, immediate: false };
}

function hasMeaningfulStreamData(text, contentType) {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (contentType.includes("text/event-stream")) {
    return text.split(/\r?\n/).some((line) => {
      if (!line.startsWith("data:")) return false;
      const payload = line.slice(5).trim();
      return payload.length > 0 && payload !== "[DONE]";
    });
  }

  if (contentType.includes("ndjson") || contentType.includes("stream+json")) {
    return text.split(/\r?\n/).some((line) => line.trim().length > 0);
  }

  return true;
}

async function readWithTimeout(reader, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("first-event-timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function rebuildResponse(response, reader, bufferedChunks) {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of bufferedChunks) controller.enqueue(chunk);
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              return;
            }
            controller.enqueue(value);
          }
        } catch (error) {
          controller.error(error);
        }
      })();
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
}

export async function inspectSuccessfulComboResponse(response, {
  startedAt = Date.now(),
  firstEventTimeoutMs = COMBO_CIRCUIT_DEFAULTS.firstEventTimeoutMs,
} = {}) {
  const contentType = String(response?.headers?.get?.("content-type") || "").toLowerCase();
  const isStreaming = contentType.includes("text/event-stream")
    || contentType.includes("ndjson")
    || contentType.includes("stream+json");
  const isBinary = contentType.startsWith("audio/")
    || contentType.startsWith("image/")
    || contentType.startsWith("video/")
    || contentType.includes("application/octet-stream");

  if (!response?.body) {
    return { ok: false, reason: "empty_response", latencyMs: Date.now() - startedAt, response };
  }

  const contentLength = response.headers?.get?.("content-length");
  if (contentLength === "0") {
    return { ok: false, reason: "empty_response", latencyMs: Date.now() - startedAt, response };
  }

  // Binary combo outputs (TTS/image/etc.) should not be decoded just to prove
  // semantic text. A non-zero/unknown-length response body is sufficient here.
  if (isBinary) {
    const latencyMs = Date.now() - startedAt;
    return {
      ok: true,
      slow: latencyMs > COMBO_CIRCUIT_DEFAULTS.slowResponseThresholdMs,
      latencyMs,
      response,
    };
  }

  if (!isStreaming) {
    const text = await response.clone().text();
    const latencyMs = Date.now() - startedAt;
    if (!text.trim()) return { ok: false, reason: "empty_response", latencyMs, response };
    return {
      ok: true,
      slow: latencyMs > COMBO_CIRCUIT_DEFAULTS.slowResponseThresholdMs,
      latencyMs,
      response,
    };
  }

  const reader = response.body.getReader();
  const bufferedChunks = [];
  const decoder = new TextDecoder();
  let decoded = "";
  const deadline = Date.now() + firstEventTimeoutMs;

  try {
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      const { done, value } = await readWithTimeout(reader, remaining);
      if (done) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: "empty_stream", latencyMs: Date.now() - startedAt, response: null };
      }
      if (value?.byteLength) {
        bufferedChunks.push(value);
        decoded += decoder.decode(value, { stream: true });
      }
      if (hasMeaningfulStreamData(decoded, contentType)) {
        const latencyMs = Date.now() - startedAt;
        return {
          ok: true,
          slow: latencyMs > COMBO_CIRCUIT_DEFAULTS.slowResponseThresholdMs,
          latencyMs,
          response: rebuildResponse(response, reader, bufferedChunks),
        };
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    return {
      ok: false,
      reason: error?.message === "first-event-timeout" ? "first_event_timeout" : "stream_probe_error",
      latencyMs: Date.now() - startedAt,
      response: null,
    };
  }

  await reader.cancel().catch(() => {});
  return { ok: false, reason: "first_event_timeout", latencyMs: Date.now() - startedAt, response: null };
}

export function buildComboProbeBody(model) {
  return {
    model,
    messages: [{ role: "user", content: "Reply with OK." }],
    max_tokens: 8,
    stream: false,
  };
}

/**
 * Run a minimal real inference against the exact provider/model before releasing
 * a quarantined combo model. When `reserved` is true, beginComboModelAttempt()
 * already owns the HALF_OPEN slot and this function completes that probe.
 */
export async function runManualComboModelProbe(model, execute, { reserved = false } = {}) {
  const state = getMutableState(model);
  if (state.probeInFlight && !reserved) {
    return { ok: false, error: "A recovery probe is already in progress", circuit: publicState(state) };
  }

  if (!reserved) {
    state.state = CIRCUIT_STATE.HALF_OPEN;
    state.probeInFlight = true;
    state.lastStateChangeAt = nowIso();
  }
  const startedAt = Date.now();

  try {
    const response = await execute(buildComboProbeBody(model));
    if (!response?.ok) {
      let errorText = response?.statusText || "Probe failed";
      try {
        const body = await response.clone().text();
        if (body.trim()) errorText = body;
      } catch {}
      const classification = classifyComboFailure(response?.status, errorText);
      const circuit = recordComboModelFailure(model, {
        ...classification,
        status: response?.status || 500,
        retryAfterMs: parseRetryAfterMs(response),
        latencyMs: Date.now() - startedAt,
        immediate: true,
      });
      return { ok: false, error: errorText, circuit };
    }

    const inspected = await inspectSuccessfulComboResponse(response, { startedAt });
    if (!inspected.ok || inspected.slow) {
      const reason = inspected.ok ? "slow_response" : inspected.reason;
      const circuit = recordComboModelFailure(model, {
        reason,
        status: inspected.ok ? 200 : 502,
        latencyMs: inspected.latencyMs,
        immediate: true,
      });
      return { ok: false, error: reason, circuit };
    }

    const circuit = recordComboModelSuccess(model, { latencyMs: inspected.latencyMs });
    return { ok: true, circuit };
  } catch (error) {
    const circuit = recordComboModelFailure(model, {
      reason: "probe_exception",
      status: 500,
      latencyMs: Date.now() - startedAt,
      immediate: true,
    });
    return { ok: false, error: error?.message || String(error), circuit };
  }
}
