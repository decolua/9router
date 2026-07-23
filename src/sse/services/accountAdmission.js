const providerStates = new Map();
const providerVersions = new Map();

export class AccountAdmissionError extends Error {
  constructor(reason, message, { retryAfterMs = null } = {}) {
    super(message);
    this.name = "AccountAdmissionError";
    this.reason = reason;
    this.retryAfterMs = retryAfterMs;
  }
}

export function isAccountAdmissionError(error) {
  return error instanceof AccountAdmissionError;
}

function requireId(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function requirePositiveLimit(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError("maxInFlightPerAccount must be a positive integer");
  }
}

function getOrCreateProviderState(providerId) {
  let state = providerStates.get(providerId);
  if (!state) {
    state = {
      accounts: new Map(),
      queue: [],
      version: providerVersions.get(providerId) || 0,
    };
    providerStates.set(providerId, state);
  }
  return state;
}

function cleanupProviderState(providerId, state) {
  if (state.accounts.size === 0 && state.queue.length === 0) {
    providerStates.delete(providerId);
  }
}

function removeWaiter(state, waiter) {
  const index = state.queue.indexOf(waiter);
  if (index >= 0) state.queue.splice(index, 1);
}

function settleWaiter(providerId, state, waiter, settle, value) {
  if (waiter.settled) return;
  waiter.settled = true;
  removeWaiter(state, waiter);
  if (waiter.timer) clearTimeout(waiter.timer);
  if (waiter.signal && waiter.abortListener) {
    waiter.signal.removeEventListener("abort", waiter.abortListener);
  }
  settle(value);
  cleanupProviderState(providerId, state);
}

function wakeNextWaiter(providerId, state) {
  const waiter = state.queue[0];
  if (!waiter) {
    cleanupProviderState(providerId, state);
    return;
  }
  settleWaiter(providerId, state, waiter, waiter.resolve, {
    reason: "capacity_changed",
    version: state.version,
  });
}

export function getProviderCapacityVersion(providerId) {
  requireId(providerId, "providerId");
  return providerVersions.get(providerId) || 0;
}

export function getAccountInFlight(providerId, connectionId) {
  requireId(providerId, "providerId");
  requireId(connectionId, "connectionId");
  return providerStates.get(providerId)?.accounts.get(connectionId) || 0;
}

export function hasAccountCapacity(providerId, connectionId, maxInFlightPerAccount) {
  requirePositiveLimit(maxInFlightPerAccount);
  return getAccountInFlight(providerId, connectionId) < maxInFlightPerAccount;
}

export function reserveAccountSlot(providerId, connectionId, maxInFlightPerAccount) {
  requireId(providerId, "providerId");
  requireId(connectionId, "connectionId");
  requirePositiveLimit(maxInFlightPerAccount);

  const state = getOrCreateProviderState(providerId);
  const current = state.accounts.get(connectionId) || 0;
  if (current >= maxInFlightPerAccount) return null;

  state.accounts.set(connectionId, current + 1);
  let released = false;

  return Object.freeze({
    providerId,
    release() {
      if (released) return false;
      released = true;

      const activeState = providerStates.get(providerId);
      if (!activeState) return false;
      const active = activeState.accounts.get(connectionId) || 0;
      if (active <= 1) activeState.accounts.delete(connectionId);
      else activeState.accounts.set(connectionId, active - 1);

      activeState.version += 1;
      providerVersions.set(providerId, activeState.version);
      wakeNextWaiter(providerId, activeState);
      return true;
    },
  });
}

export function waitForProviderCapacity(providerId, {
  afterVersion = 0,
  maxQueueSize,
  queueTimeoutMs,
  signal = null,
} = {}) {
  requireId(providerId, "providerId");
  if (!Number.isInteger(maxQueueSize) || maxQueueSize < 0) {
    return Promise.reject(new TypeError("maxQueueSize must be a non-negative integer"));
  }
  if (!Number.isInteger(queueTimeoutMs) || queueTimeoutMs < 1) {
    return Promise.reject(new TypeError("queueTimeoutMs must be a positive integer"));
  }
  if (signal?.aborted) {
    return Promise.reject(new AccountAdmissionError(
      "request_aborted",
      "Request was aborted while waiting for provider capacity",
    ));
  }

  const state = getOrCreateProviderState(providerId);
  if (state.version !== afterVersion) {
    cleanupProviderState(providerId, state);
    return Promise.resolve({
      reason: "capacity_changed",
      version: state.version,
    });
  }
  if (state.queue.length >= maxQueueSize) {
    cleanupProviderState(providerId, state);
    return Promise.reject(new AccountAdmissionError(
      "queue_full",
      "Provider admission queue is full",
      { retryAfterMs: queueTimeoutMs },
    ));
  }

  return new Promise((resolve, reject) => {
    const waiter = {
      resolve,
      reject,
      signal,
      abortListener: null,
      timer: null,
      settled: false,
    };

    waiter.abortListener = () => {
      settleWaiter(
        providerId,
        state,
        waiter,
        reject,
        new AccountAdmissionError(
          "request_aborted",
          "Request was aborted while waiting for provider capacity",
        ),
      );
    };
    if (signal) signal.addEventListener("abort", waiter.abortListener, { once: true });

    waiter.timer = setTimeout(() => {
      settleWaiter(
        providerId,
        state,
        waiter,
        reject,
        new AccountAdmissionError(
          "queue_timeout",
          "Timed out waiting for provider capacity",
          { retryAfterMs: queueTimeoutMs },
        ),
      );
    }, queueTimeoutMs);

    state.queue.push(waiter);
  });
}

export function getAdmissionSnapshot() {
  const providers = {};
  for (const [providerId, state] of [...providerStates.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    let active = 0;
    for (const count of state.accounts.values()) active += count;
    providers[providerId] = {
      active,
      queued: state.queue.length,
      accountCount: state.accounts.size,
    };
  }
  return { providers };
}

export function __resetAccountAdmissionForTests() {
  for (const [providerId, state] of providerStates.entries()) {
    for (const waiter of [...state.queue]) {
      settleWaiter(
        providerId,
        state,
        waiter,
        waiter.reject,
        new AccountAdmissionError("reset", "Admission state reset"),
      );
    }
  }
  providerStates.clear();
  providerVersions.clear();
}
