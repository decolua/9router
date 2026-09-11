import { RESILIENCE_FEATURES, RESILIENCE_PROFILES, MAX_COOLDOWN_MS, getDegradedThreshold } from "../config/resilienceConfig.js";
import { getProviderCategory } from "../providers/index.js";
import { clearProviderFailureBucket, getProviderFailureCount, recordProviderFailure } from "./providerFailureTracker.js";

const states = new Map();
const keyOf = (provider, bucket) => `${provider}\u0000${bucket}`;

function profile(provider) {
  return RESILIENCE_PROFILES[getProviderCategory(provider)] || RESILIENCE_PROFILES.unknown;
}

function stateFor(provider, bucket) {
  const key = keyOf(provider, bucket);
  let state = states.get(key);
  if (!state) {
    state = {
      state: "CLOSED",
      cooldownMs: profile(provider).cooldownMs,
      openedAt: 0,
      probeClaimed: false,
    };
    states.set(key, state);
  }
  return state;
}

export function evaluateCircuit(provider, bucket, now = Date.now()) {
  if (!RESILIENCE_FEATURES.breaker || !provider || !bucket) {
    return { state: "CLOSED", allowed: true, retryAfterMs: 0, probe: false };
  }

  const state = stateFor(provider, bucket);
  const count = getProviderFailureCount(provider, bucket, now);
  const category = getProviderCategory(provider);
  const threshold = profile(provider).failureThreshold;

  if (state.state === "OPEN") {
    const remaining = state.openedAt + state.cooldownMs - now;
    if (remaining > 0) return { state: "OPEN", allowed: false, retryAfterMs: remaining, probe: false };
    state.state = "HALF_OPEN";
    state.probeClaimed = false;
  }

  if (state.state === "HALF_OPEN") {
    if (state.probeClaimed) return { state: "OPEN", allowed: false, retryAfterMs: state.cooldownMs, probe: false };
    state.probeClaimed = true;
    return { state: "HALF_OPEN", allowed: true, retryAfterMs: 0, probe: true };
  }

  if (count >= threshold) {
    state.state = "OPEN";
    state.openedAt = now;
    return { state: "OPEN", allowed: false, retryAfterMs: state.cooldownMs, probe: false };
  }

  return {
    state: count >= getDegradedThreshold(category) ? "DEGRADED" : "CLOSED",
    allowed: true,
    retryAfterMs: 0,
    probe: false,
  };
}

export function recordCircuitOutcome({ provider, bucket, outcome, status, origin, connectionId, now = Date.now() }) {
  if (!RESILIENCE_FEATURES.breaker || !provider || !bucket) return;

  const state = stateFor(provider, bucket);
  const probe = state.state === "HALF_OPEN" && state.probeClaimed;

  if (outcome === "STREAM_COMPLETED" || outcome === "NON_STREAM_COMPLETED") {
    clearProviderFailureBucket(provider, bucket);
    state.state = "CLOSED";
    state.probeClaimed = false;
    state.cooldownMs = profile(provider).cooldownMs;
    return;
  }

  if (outcome === "CLIENT_ABORTED" || outcome === "local_router" || outcome === "proxy_pool") {
    if (probe) state.probeClaimed = false;
    return;
  }

  const recorded = recordProviderFailure({ provider, bucket, origin, status, connectionId }, now);
  if (probe && (recorded.recorded || origin === "credential_failure")) {
    if (origin !== "credential_failure") {
      state.cooldownMs = Math.min(state.cooldownMs * 2, MAX_COOLDOWN_MS);
    }
    state.openedAt = now;
    state.state = "OPEN";
    state.probeClaimed = false;
  }
}

export function resetCircuitBreaker() {
  states.clear();
}

export function getCircuitSnapshot(provider, bucket, now = Date.now()) {
  const state = evaluateCircuit(provider, bucket, now);
  return { ...state, failureCount: getProviderFailureCount(provider, bucket, now) };
}
