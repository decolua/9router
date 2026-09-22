"use client";

// Client-side batch model tester with a bounded concurrency pool.
// Drives POST /api/models/test per model (same probe the per-model "Test"
// button uses) and reports per-model results + a running summary via callbacks.
// Mirrors the existing "Test Connection One-by-One" UX on the provider detail
// page, but runs models concurrently instead of serially.

export const MODEL_TEST_CONCURRENCY = 4;

/**
 * @param {object} opts
 * @param {Array<{id: string, fullModel: string}>} opts.models - models to test
 * @param {(model: {id: string, fullModel: string}) => string} opts.buildFullModel - map model -> routed model id
 * @param {(modelId: string, result: {state: "queued"|"testing"|"ok"|"error", latencyMs: number|null, error: string|null}) => void} opts.onResult
 * @param {(summary: {total: number, completed: number, passed: number, failed: number, avgLatencyMs: number|null, stopped: boolean}) => void} opts.onSummary
 * @param {{current: boolean}} opts.stopRef - set to true to stop gracefully
 * @returns {Promise<{total: number, completed: number, passed: number, failed: number, avgLatencyMs: number|null, stopped: boolean}>}
 */
export async function runModelBatchTest({ models, buildFullModel, onResult, onSummary, stopRef }) {
  const total = models.length;
  let completed = 0;
  let passed = 0;
  let failed = 0;
  let latencySum = 0;
  let latencyCount = 0;
  let finalSummary = null;

  const emitSummary = (stopped = false) => {
    finalSummary = {
      total,
      completed,
      passed,
      failed,
      avgLatencyMs: latencyCount > 0 ? Math.round(latencySum / latencyCount) : null,
      stopped,
    };
    onSummary?.(finalSummary);
    return finalSummary;
  };

  emitSummary(false);

  let nextIndex = 0;
  const workerCount = Math.min(MODEL_TEST_CONCURRENCY, Math.max(total, 1));

  const worker = async () => {
    while (!stopRef.current) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= total) return;

      const model = models[index];
      onResult(model.id, { state: "testing", latencyMs: null, error: null });

      try {
        const res = await fetch("/api/models/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: buildFullModel(model) }),
        });
        const data = await res.json().catch(() => ({}));
        const ok = !!data.ok;

        onResult(model.id, {
          state: ok ? "ok" : "error",
          latencyMs: typeof data.latencyMs === "number" ? data.latencyMs : null,
          error: ok ? null : (data.error || "Model not reachable"),
        });

        if (ok) passed += 1;
        else failed += 1;
        if (typeof data.latencyMs === "number") {
          latencySum += data.latencyMs;
          latencyCount += 1;
        }
      } catch {
        failed += 1;
        onResult(model.id, { state: "error", latencyMs: null, error: "Network error" });
      }

      completed += 1;
      emitSummary(false);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return emitSummary(stopRef.current);
}
