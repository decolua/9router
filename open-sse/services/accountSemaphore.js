/**
 * Account Semaphore — in-memory provider/account concurrency limiter.
 *
 * Requests beyond the configured concurrency cap wait in a FIFO queue until a
 * slot opens, the gate is unblocked, or the queue timeout expires.
 *
 * Keys are provider:connectionId (per-account). No proxyHash.
 */

export function buildAccountSemaphoreKey({ provider, connectionId }) {
  return `${String(provider)}:${String(connectionId)}`;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_QUEUE_SIZE = 20;
const DEFAULT_MAX_CONCURRENCY = 3;

const gates = new Map();

class SemaphoreCapacityError extends Error {
  constructor(key, timeoutMs) {
    super(`Semaphore "${key}" capacity reached — timed out after ${timeoutMs}ms`);
    this.name = "SemaphoreCapacityError";
    this.semaphoreKey = key;
    this.timeoutMs = timeoutMs;
  }
}

function isBypassed(maxConcurrency) {
  return maxConcurrency == null || maxConcurrency <= 0;
}

function ensureGate(semaphoreKey, maxConcurrency) {
  let gate = gates.get(semaphoreKey);
  if (gate) {
    gate.maxConcurrency = maxConcurrency;
    return gate;
  }
  gate = {
    running: 0,
    maxConcurrency,
    queue: [],
    blockedUntil: null,
    cleanupTimer: null,
    unblockTimer: null,
  };
  gates.set(semaphoreKey, gate);
  return gate;
}

function cleanupGateIfIdle(semaphoreKey, gate) {
  if (!gate) return;
  if (gate.running === 0 && gate.queue.length === 0 && (!gate.blockedUntil || Date.now() >= gate.blockedUntil)) {
    if (gate.cleanupTimer) {
      clearTimeout(gate.cleanupTimer);
      gate.cleanupTimer = null;
    }
    if (gate.unblockTimer) {
      clearTimeout(gate.unblockTimer);
      gate.unblockTimer = null;
    }
    gates.delete(semaphoreKey);
  }
}

function scheduleCleanup(semaphoreKey, gate) {
  if (gate.cleanupTimer) return;
  // Immediate cleanup attempt on next tick, then keep only a short safety window.
  gate.cleanupTimer = setTimeout(() => {
    gate.cleanupTimer = null;
    cleanupGateIfIdle(semaphoreKey, gate);
  }, 0);
  if (typeof gate.cleanupTimer.unref === "function") gate.cleanupTimer.unref();
}

/**
 * Acquire a semaphore slot. Returns a release function.
 * Rejects with SemaphoreCapacityError on timeout.
 */
export function acquire(semaphoreKey, options = {}) {
  const maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = options.signal ?? null;
  const maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;

  if (isBypassed(maxConcurrency)) {
    return Promise.resolve(() => {});
  }

  if (signal?.aborted) {
    return Promise.reject(signal.reason || new Error("Aborted"));
  }

  const gate = ensureGate(semaphoreKey, maxConcurrency);

  // Check if gate is blocked (e.g. from 429 markBlocked).
  // Do not grant ahead of queued waiters (FIFO after unblock).
  if (gate.blockedUntil && Date.now() < gate.blockedUntil) {
    // Still blocked — queue the request
  } else {
    gate.blockedUntil = null;
    if (gate.running < gate.maxConcurrency && gate.queue.length === 0) {
      gate.running++;
      let released = false;
      return Promise.resolve(() => {
        if (released) return;
        released = true;
        gate.running--;
        drainQueue(semaphoreKey, gate);
      });
    }
  }

  // Queue full?
  if (gate.queue.length >= maxQueueSize) {
    return Promise.reject(new SemaphoreCapacityError(semaphoreKey, 0));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let entry;

    const settleCleanup = () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener?.("abort", onAbort);
      if (entry) {
        const idx = gate.queue.indexOf(entry);
        if (idx >= 0) gate.queue.splice(idx, 1);
      }
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      settleCleanup();
      reject(signal.reason || new Error("Aborted"));
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      settleCleanup();
      reject(new SemaphoreCapacityError(semaphoreKey, timeoutMs));
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();

    entry = {
      resolve: (release) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener?.("abort", onAbort);
        resolve(release);
      },
      reject: (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener?.("abort", onAbort);
        reject(err);
      },
      timer,
    };
    gate.queue.push(entry);

    if (signal) {
      // Already-aborted signals do not fire "abort" for a newly added listener on Node.
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener?.("abort", onAbort);
    }

    // Idle blocked gate: markBlocked skipped the timer (running!==0); release saw
    // an empty queue so never scheduled either. Enqueue must arm unblockDrain.
    if (gate.blockedUntil && Date.now() < gate.blockedUntil) {
      scheduleUnblockDrain(semaphoreKey, gate);
    }

    scheduleCleanup(semaphoreKey, gate);
  });
}

function scheduleUnblockDrain(semaphoreKey, gate) {
  if (gate.unblockTimer) {
    clearTimeout(gate.unblockTimer);
    gate.unblockTimer = null;
  }
  if (gate.running !== 0 || gate.queue.length === 0) return;
  if (!gate.blockedUntil) return;
  const delay = Math.max(0, gate.blockedUntil - Date.now());
  gate.unblockTimer = setTimeout(() => {
    gate.unblockTimer = null;
    drainQueue(semaphoreKey, gate);
  }, delay);
  if (typeof gate.unblockTimer.unref === "function") gate.unblockTimer.unref();
}

function drainQueue(semaphoreKey, gate) {
  while (gate.queue.length > 0 && gate.running < gate.maxConcurrency) {
    if (gate.blockedUntil && Date.now() < gate.blockedUntil) {
      scheduleUnblockDrain(semaphoreKey, gate);
      break;
    }
    gate.blockedUntil = null;
    const entry = gate.queue.shift();
    if (!entry) break;
    gate.running++;
    let released = false;
    entry.resolve(() => {
      if (released) return;
      released = true;
      gate.running--;
      drainQueue(semaphoreKey, gate);
    });
  }

  // If nothing is running and nothing is waiting, schedule an immediate cleanup.
  if (gate.running === 0 && gate.queue.length === 0 && (!gate.blockedUntil || Date.now() >= gate.blockedUntil)) {
    scheduleCleanup(semaphoreKey, gate);
  }
}

/**
 * Temporarily block all requests to a gate (e.g. after 429).
 * When idle with waiters queued, schedule drainQueue at blockedUntil so they
 * are not stuck until their acquire timeout.
 */
export function markBlocked(semaphoreKey, durationMs) {
  const gate = gates.get(semaphoreKey);
  if (!gate) return;
  const until = Date.now() + durationMs;
  if (!gate.blockedUntil || gate.blockedUntil < until) {
    gate.blockedUntil = until;
  }
  scheduleUnblockDrain(semaphoreKey, gate);
}

/**
 * Get stats for all gates (for dashboard).
 */
export function getAccountSemaphoreStats() {
  const result = [];
  for (const [key, gate] of gates) {
    result.push({
      key,
      running: gate.running,
      queued: gate.queue.length,
      maxConcurrency: gate.maxConcurrency,
      blockedUntil: gate.blockedUntil ? new Date(gate.blockedUntil).toISOString() : null,
    });
  }
  return result;
}

export function isSemaphoreCapacityError(error) {
  return error instanceof SemaphoreCapacityError;
}

/**
 * Resolve the semaphore key from request context.
 * Returns null if provider or connectionId is missing.
 */
export function resolveAccountSemaphoreKey({ provider, connectionId }) {
  if (!provider || !connectionId) return null;
  return buildAccountSemaphoreKey({ provider, connectionId });
}

/**
 * Resolve max concurrency from connection settings.
 *
 * Opt-in: returns null (bypass) unless the connection sets a positive
 * `maxConcurrency` in providerSpecificData. Upstream imposes no cap, and a
 * default one throttled ordinary parallel traffic — an agentic client easily
 * exceeds a handful of in-flight requests per account, and each request over
 * the cap burned a probe timeout and fell through to the next account before
 * the provider was ever called.
 */
export function resolveAccountSemaphoreMaxConcurrency(credentials) {
  const max = credentials?.providerSpecificData?.maxConcurrency;
  if (typeof max === "number" && max > 0) return max;
  return null; // no cap unless explicitly configured
}

export { SemaphoreCapacityError };
