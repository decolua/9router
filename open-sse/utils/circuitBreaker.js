/**
 * Circuit Breaker — in-memory only (no DB persistence).
 *
 * States: CLOSED → DEGRADED → OPEN → HALF_OPEN → CLOSED
 * - CLOSED: normal operation, requests pass through
 * - DEGRADED: failure rate elevated, requests still pass but warnings logged
 * - OPEN: requests short-circuited (skip account entirely)
 * - HALF_OPEN: limited probe requests to test recovery
 *
 * Keys are provider:connectionId (per-account). 429 is not a failure code.
 */

export const STATE = {
  CLOSED: "CLOSED",
  DEGRADED: "DEGRADED",
  OPEN: "OPEN",
  HALF_OPEN: "HALF_OPEN",
};

/** Error codes that count toward account-level failure threshold. */
// Only provider-level errors (5xx + timeout) count toward the circuit breaker.
// 429 is per-account rate limiting, NOT a provider-wide failure — including it
// would trip the breaker after rate-limits and block the account unnecessarily.
export const PROVIDER_FAILURE_ERROR_CODES = new Set([408, 500, 502, 503, 504]);

/** Failure kinds for per-kind thresholds. */
export const FAILURE_KIND = {
  TRANSIENT: "transient",
  RATE_LIMIT: "rate_limit",
  QUOTA_EXHAUSTED: "quota_exhausted",
};

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_RESET_TIMEOUT_MS = 30_000;
const DEFAULT_HALF_OPEN_REQUESTS = 1;
const DEFAULT_DEGRADATION_RATIO = 0.6;
const DEFAULT_MAX_BACKOFF_MULTIPLIER = 16;
const DEFAULT_BACKOFF_ESCALATION_COUNT = 3;

/** Detect local stream-lifecycle errors that must NOT count as provider failures. */
export function isLocalStreamLifecycleError(error) {
  if (!error) return false;
  const message =
    typeof error === "string"
      ? error
      : typeof error.message === "string"
        ? error.message
        : "";
  return /controller is already closed/i.test(message);
}

/**
 * Build the breaker key: `${provider}:${connectionId}:${model}`.
 *
 * The model is part of the key on purpose. Upstream locks per model
 * (`modelLock_${model}`), and an account-wide key made one failing model take
 * every other model on the same account down with it — inside a combo that
 * silently removed the fallback the user configured.
 *
 * `model` is omitted only by callers that have no model in hand; those get an
 * account-scoped key that no per-model breaker can collide with, so they never
 * block a healthy model by accident.
 */
export function buildAccountBreakerName({ provider, connectionId, model }) {
  const base = `${String(provider)}:${String(connectionId)}`;
  return model ? `${base}:${String(model)}` : base;
}

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.state = STATE.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.lastStateChange = Date.now();
    this.openedAt = null;
    this.resetTimeoutMs = options.resetTimeout || DEFAULT_RESET_TIMEOUT_MS;
    this.failureThreshold = options.failureThreshold || DEFAULT_FAILURE_THRESHOLD;
    this.failureWindowMs = options.failureWindowMs || 0; // 0 = cumulative (legacy behavior)
    this.failureTimestamps = []; // only used when failureWindowMs > 0
    this.halfOpenRequests = options.halfOpenRequests || DEFAULT_HALF_OPEN_REQUESTS;
    this.halfOpenRemaining = 0;
    this.maxBackoffMultiplier = options.maxBackoffMultiplier || DEFAULT_MAX_BACKOFF_MULTIPLIER;
    this.backoffEscalationCount = options.backoffEscalationCount || DEFAULT_BACKOFF_ESCALATION_COUNT;
    this.openProbeCycles = 0;
    this.degradationThreshold = options.degradationThreshold || Math.floor(this.failureThreshold * DEFAULT_DEGRADATION_RATIO);
    this.cooldownByKind = options.cooldownByKind || {};
    this.classifyError = options.classifyError || null;
    this.isFailure = options.isFailure || null;
    this.kindThresholds = options.kindThresholds || {};
    this._transitionHistory = [];
  }

  _transition(newState) {
    const old = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();
    this._transitionHistory.push({ from: old, to: newState, at: new Date().toISOString() });
    if (this._transitionHistory.length > 20) this._transitionHistory.shift();
    if (newState === STATE.OPEN) {
      this.openedAt = Date.now();
      this.halfOpenRemaining = 0;
    } else if (newState === STATE.HALF_OPEN) {
      this.halfOpenRemaining = this.halfOpenRequests;
    } else if (newState === STATE.CLOSED) {
      this.failureCount = 0;
      this.successCount = 0;
      this.openProbeCycles = 0;
      this.openedAt = null;
    }
  }

  canExecute() {
    const now = Date.now();
    if (this.state === STATE.CLOSED) return true;
    if (this.state === STATE.DEGRADED) return true;
    if (this.state === STATE.OPEN) {
      const elapsed = now - (this.openedAt || now);
      const multiplier = Math.min(Math.pow(2, Math.floor(this.openProbeCycles / this.backoffEscalationCount)), this.maxBackoffMultiplier);
      const effectiveTimeout = this.resetTimeoutMs * multiplier;
      if (elapsed >= effectiveTimeout) {
        this._transition(STATE.HALF_OPEN);
        // This call is the probe — consume one of the HALF_OPEN slots.
        if (this.halfOpenRemaining > 0) this.halfOpenRemaining--;
        return true;
      }
      return false;
    }
    if (this.state === STATE.HALF_OPEN) {
      if (this.halfOpenRemaining > 0) {
        this.halfOpenRemaining--;
        return true;
      }
      return false;
    }
    return true;
  }

  _onSuccess() {
    this.successCount++;
    if (this.state === STATE.HALF_OPEN) {
      this._transition(STATE.CLOSED);
    } else if (this.state === STATE.DEGRADED && this.successCount >= this.failureThreshold) {
      this._transition(STATE.CLOSED);
    }
  }

  _pruneFailureTimestamps() {
    if (!this.failureWindowMs || this.failureWindowMs <= 0) return;
    const cutoff = Date.now() - this.failureWindowMs;
    const idx = this.failureTimestamps.findIndex((ts) => ts >= cutoff);
    if (idx > 0) {
      this.failureTimestamps = this.failureTimestamps.slice(idx);
    } else if (idx === -1) {
      this.failureTimestamps = [];
    }
  }

  _countFailuresInWindow() {
    if (!this.failureWindowMs || this.failureWindowMs <= 0) return this.failureCount;
    this._pruneFailureTimestamps();
    return this.failureTimestamps.length;
  }

  _onFailure(error) {
    if (this.isFailure && !this.isFailure(error)) return;
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureWindowMs > 0) {
      this.failureTimestamps.push(Date.now());
      this._pruneFailureTimestamps();
    }

    if (this.state === STATE.HALF_OPEN) {
      this.openProbeCycles++;
      this._transition(STATE.OPEN);
      return;
    }

    if (this.state === STATE.OPEN) return;

    const kind = this.classifyError ? this.classifyError(error) : FAILURE_KIND.TRANSIENT;
    const kindThreshold = this.kindThresholds[kind];
    if (kindThreshold?.immediateOpen) {
      this._transition(STATE.OPEN);
      return;
    }

    const effectiveThreshold = kindThreshold?.threshold || this.failureThreshold;
    const failureCount = this._countFailuresInWindow();

    if (failureCount >= effectiveThreshold) {
      this._transition(STATE.OPEN);
    } else if (failureCount >= this.degradationThreshold) {
      if (this.state === STATE.CLOSED) this._transition(STATE.DEGRADED);
    }
  }

  getRetryAfterMs() {
    if (this.state !== STATE.OPEN || !this.openedAt) return 0;
    const multiplier = Math.min(Math.pow(2, Math.floor(this.openProbeCycles / this.backoffEscalationCount)), this.maxBackoffMultiplier);
    const effectiveTimeout = this.resetTimeoutMs * multiplier;
    const remaining = effectiveTimeout - (Date.now() - (this.openedAt || Date.now()));
    return remaining > 0 ? remaining : 0;
  }

  reset() {
    this._transition(STATE.CLOSED);
  }

  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      retryAfterMs: this.getRetryAfterMs(),
      openedAt: this.openedAt,
      transitions: this._transitionHistory.slice(-5),
    };
  }
}

// In-memory registry
const registry = new Map();

export function getCircuitBreaker(name, options) {
  if (!name) return null;
  let breaker = registry.get(name);
  if (breaker) {
    if (options) {
      if (options.failureThreshold != null) breaker.failureThreshold = options.failureThreshold;
      if (options.resetTimeout != null) breaker.resetTimeoutMs = options.resetTimeout;
      if (options.degradationThreshold != null) breaker.degradationThreshold = options.degradationThreshold;
      if (options.halfOpenRequests != null) breaker.halfOpenRequests = options.halfOpenRequests;
      if (options.cooldownByKind) breaker.cooldownByKind = options.cooldownByKind;
      if (options.classifyError) breaker.classifyError = options.classifyError;
      if (options.isFailure) breaker.isFailure = options.isFailure;
      if (options.kindThresholds) breaker.kindThresholds = options.kindThresholds;
      if (options.maxBackoffMultiplier != null) breaker.maxBackoffMultiplier = options.maxBackoffMultiplier;
      if (options.backoffEscalationCount != null) breaker.backoffEscalationCount = options.backoffEscalationCount;
    }
    return breaker;
  }
  if (!options) return null;
  breaker = new CircuitBreaker(name, options);
  registry.set(name, breaker);
  return breaker;
}

export function recordFailure(name, error) {
  const breaker = registry.get(name);
  if (!breaker) return;
  breaker._onFailure(error);
}

export function recordSuccess(name) {
  const breaker = registry.get(name);
  if (!breaker) return;
  breaker._onSuccess();
}

export function canExecute(name) {
  const breaker = registry.get(name);
  if (!breaker) return true;
  return breaker.canExecute();
}

/** Pure: do not OPEN→HALF_OPEN. Used by getProviderCredentials. */
export function isBlocked(name) {
  const breaker = registry.get(name);
  if (!breaker) return false;
  if (breaker.state !== STATE.OPEN) return false;
  return breaker.getRetryAfterMs() > 0;
}

export function getRetryAfterMs(name) {
  const breaker = registry.get(name);
  if (!breaker) return 0;
  return breaker.getRetryAfterMs();
}

export function shouldRecordBreakerFailure(status) {
  return PROVIDER_FAILURE_ERROR_CODES.has(status);
}

export function getAllCircuitBreakerStatuses() {
  return Array.from(registry.values()).map((b) => b.getStatus());
}

export function resetAllCircuitBreakers() {
  for (const breaker of registry.values()) breaker.reset();
}

export function resetCircuitBreaker(name) {
  const breaker = registry.get(name);
  if (breaker) breaker.reset();
}

export { CircuitBreaker };

export class CircuitBreakerOpenError extends Error {
  constructor(name, retryAfterMs) {
    super(`Circuit breaker "${name}" is OPEN — retry after ${Math.ceil(retryAfterMs / 1000)}s`);
    this.name = "CircuitBreakerOpenError";
    this.breakerName = name;
    this.retryAfterMs = retryAfterMs;
  }
}
