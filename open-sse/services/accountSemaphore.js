import { RESILIENCE_FEATURES, DEFAULT_SEMAPHORE_CONCURRENCY, DEFAULT_SEMAPHORE_QUEUE_SIZE, DEFAULT_SEMAPHORE_TIMEOUT_MS } from "../config/resilienceConfig.js";
export class SemaphoreCapacityError extends Error { constructor(message = "Account concurrency capacity exhausted") { super(message); this.name = "SemaphoreCapacityError"; } }
export class SemaphoreAbortError extends SemaphoreCapacityError { constructor() { super("Semaphore acquisition aborted"); this.name = "SemaphoreAbortError"; } }
const gates = new Map();
const keyOf = (provider, connectionId, bucket) => `${provider}\u0000${connectionId}\u0000${bucket}`;
function maxConcurrency(value, warn = console.warn) {
  if (value === 0 || value === null) return 0;
  if (value === undefined) return DEFAULT_SEMAPHORE_CONCURRENCY;
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (!Number.isInteger(parsed) || parsed < 0) { warn("[resilience] Invalid maxConcurrency; using default"); return DEFAULT_SEMAPHORE_CONCURRENCY; }
  return parsed;
}
function cleanup(key, gate) { Promise.resolve().then(() => { if (gate.active === 0 && gate.queue.length === 0 && gates.get(key) === gate) gates.delete(key); }); }
export function acquireAccountSlot({ provider, connectionId, bucket, maxConcurrency: configured, queueSize = DEFAULT_SEMAPHORE_QUEUE_SIZE, timeoutMs = DEFAULT_SEMAPHORE_TIMEOUT_MS, signal, warn } = {}) {
  if (!RESILIENCE_FEATURES.semaphore) return Promise.resolve(() => {});
  const limit = maxConcurrency(configured, warn); if (limit === 0) return Promise.resolve(() => {});
  const key = keyOf(provider, connectionId, bucket); let gate = gates.get(key); if (!gate) { gate = { active: 0, queue: [] }; gates.set(key, gate); }
  const settle = (waiter, fn, value) => { if (waiter.settled) return; waiter.settled = true; clearTimeout(waiter.timer); waiter.signal?.removeEventListener("abort", waiter.onAbort); const index = gate.queue.indexOf(waiter); if (index >= 0) gate.queue.splice(index, 1); fn(value); };
  const release = () => { if (release.done) return; release.done = true; gate.active--; const next = gate.queue[0]; if (next) { settle(next, next.resolve, makeRelease()); } else cleanup(key, gate); };
  const makeRelease = () => { gate.active++; let done = false; return () => { if (done) return; done = true; gate.active--; const next = gate.queue[0]; if (next) settle(next, next.resolve, makeRelease()); else cleanup(key, gate); }; };
  if (gate.active < limit && gate.queue.length === 0) return Promise.resolve(makeRelease());
  if (gate.queue.length >= queueSize) return Promise.reject(new SemaphoreCapacityError());
  return new Promise((resolve, reject) => { const waiter = { resolve: value => resolve(value), reject, settled: false, timer: null, signal, onAbort: null }; waiter.onAbort = () => settle(waiter, reject, new SemaphoreAbortError()); waiter.timer = setTimeout(() => settle(waiter, reject, new SemaphoreCapacityError("Semaphore acquisition timed out")), timeoutMs); signal?.addEventListener("abort", waiter.onAbort, { once: true }); gate.queue.push(waiter); });
}
export function resetAccountSemaphores() { for (const gate of gates.values()) { for (const waiter of gate.queue.splice(0)) { clearTimeout(waiter.timer); waiter.signal?.removeEventListener("abort", waiter.onAbort); waiter.reject(new SemaphoreCapacityError("Semaphore reset")); } } gates.clear(); }
export function getAccountSemaphoreSnapshot() { return [...gates.entries()].map(([key, gate]) => ({ key, active: gate.active, queued: gate.queue.length })); }
