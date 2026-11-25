/**
 * FIFO concurrency gate for executors that spawn a real process per request.
 *
 * A routed request normally costs one HTTP connection; a CLI-backed provider
 * costs a whole interpreter (a `claude -p` child measures ~230 MB resident), so
 * a client that fans out subagents can exhaust the host. Requests past the limit
 * queue instead of spawning, and give up with a clear error rather than piling up.
 */

export function createConcurrencyGate({ limit, queueTimeoutMs }) {
  const state = { active: 0, queue: [] };

  const resolveLimit = () => (typeof limit === "function" ? limit() : limit);

  function release() {
    state.active -= 1;
    // Hand the slot to the next waiter that is still interested.
    while (state.queue.length > 0) {
      const next = state.queue.shift();
      if (next.settled) continue;
      next.settle();
      state.active += 1;
      next.resolve(release);
      return;
    }
  }

  /**
   * @returns {Promise<() => void>} resolves with the release function.
   * Rejects with a `code` of "queue_timeout" or "aborted".
   */
  function acquire(signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(Object.assign(new Error("Request aborted before a slot was free"), { code: "aborted" }));
        return;
      }

      if (state.active < resolveLimit()) {
        state.active += 1;
        resolve(release);
        return;
      }

      const waiter = { settled: false, resolve, reject, timer: null, onAbort: null };
      waiter.settle = ({ dequeue = false } = {}) => {
        waiter.settled = true;
        if (waiter.timer) clearTimeout(waiter.timer);
        if (waiter.onAbort) signal?.removeEventListener?.("abort", waiter.onAbort);
        // A waiter that gave up must leave the queue now. Relying on the next
        // release() to sweep it lets the array grow without bound while every
        // slot stays busy.
        if (dequeue) {
          const at = state.queue.indexOf(waiter);
          if (at >= 0) state.queue.splice(at, 1);
        }
      };

      waiter.timer = setTimeout(() => {
        if (waiter.settled) return;
        waiter.settle({ dequeue: true });
        reject(Object.assign(
          new Error(`Timed out after ${queueTimeoutMs}ms waiting for a free slot (limit ${resolveLimit()})`),
          { code: "queue_timeout" },
        ));
      }, queueTimeoutMs);
      if (waiter.timer.unref) waiter.timer.unref();

      waiter.onAbort = () => {
        if (waiter.settled) return;
        waiter.settle({ dequeue: true });
        reject(Object.assign(new Error("Request aborted while queued"), { code: "aborted" }));
      };
      signal?.addEventListener?.("abort", waiter.onAbort, { once: true });

      state.queue.push(waiter);
    });
  }

  return {
    acquire,
    stats: () => ({ active: state.active, queued: state.queue.length, limit: resolveLimit() }),
  };
}
