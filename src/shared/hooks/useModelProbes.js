"use client";

/**
 * Real-request capability probes for the model picker.
 *
 * Probes are REAL upstream calls (see /api/models/probe), not a reading of the
 * static capability table — a model that declares tool support but 500s on a
 * tool request shows up here as broken. Because each probe costs a real call,
 * results are persisted server-side and loaded on open rather than re-run.
 *
 * The sweep is chunked client-side instead of sent as one request: a single
 * request covering the whole catalog would blow the route's time budget and
 * report nothing, while chunks give live progress, cancellation, and results
 * that land incrementally.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { needsProbing } from "@/lib/probe/filters";

/**
 * Sized so one chunk finishes well inside the route's 300s budget while keeping
 * HTTP round-trips to a small fraction of the work.
 */
const CHUNK_SIZE = 120;

/**
 * Chunks are pipelined rather than awaited one at a time. Sending the next chunk
 * only after the previous response lands leaves the pool empty for the duration
 * of a round trip on every boundary, which on a multi-chunk sweep is pure dead
 * time. Running a few at once keeps the pipeline full.
 */
const CHUNKS_IN_FLIGHT = 3;

/**
 * Concurrency is mostly waiting on upstream sockets, not CPU, so the ceiling can
 * be high. The per-provider cap is what protects correctness: without it a burst
 * lands on one provider, trips its rate limit, and its models get recorded as
 * broken when they are merely throttled. These are per chunk, so the effective
 * ceilings are CHUNKS_IN_FLIGHT times each.
 */
const CONCURRENCY = 24;
const PER_PROVIDER = 2;

export function useModelProbes({ enabled = true } = {}) {
  const [probes, setProbes] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total, rate, etaSec }
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!enabled || loaded) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/models/probe");
        if (!res.ok) return;
        const data = await res.json();
        if (alive && data?.results) setProbes(data.results);
      } catch {
        // Fail-open: no stored probes just means no probe filters yet.
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, loaded]);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  /**
   * Probe every model in `models`, updating state as each chunk lands.
   *
   * @param {string[]} models
   * @param {Object} [options]
   * @param {boolean} [options.probeAudio=false] - extra call per model
   * @param {boolean} [options.skipMeasured=true] - don't re-pay for known results
   * @returns {Promise<{done:number, skipped:number, cancelled:boolean}>}
   */
  const probeAll = useCallback(
    async (models, options = {}) => {
      const { probeAudio = false, skipMeasured = true } = options;
      const unique = [...new Set((models || []).filter((m) => typeof m === "string" && m.trim()))];

      // Only models that have not yet answered are re-probed; see needsProbing.
      const list = skipMeasured
        ? unique.filter((m) => needsProbing(probes[m], { probeAudio }))
        : unique;

      const skipped = unique.length - list.length;
      if (list.length === 0) return { done: 0, skipped, cancelled: false };

      cancelRef.current = false;
      const startedAt = Date.now();
      setProgress({ done: 0, total: list.length, rate: null, etaSec: null });

      const chunks = [];
      for (let i = 0; i < list.length; i += CHUNK_SIZE) chunks.push(list.slice(i, i + CHUNK_SIZE));

      let done = 0;
      let cursor = 0;

      const runChunk = async (chunk) => {
        try {
          const res = await fetch("/api/models/probe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              models: chunk,
              concurrency: CONCURRENCY,
              perProvider: PER_PROVIDER,
              probeAudio,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            const landed = Array.isArray(data?.results) ? data.results : [];
            setProbes((prev) => {
              const next = { ...prev };
              for (const r of landed) if (r?.model) next[r.model] = { ...r, stale: false };
              return next;
            });
          }
        } catch {
          // A failed chunk must not abort the sweep — the rest may well succeed.
        }
        done += chunk.length;

        const elapsedSec = (Date.now() - startedAt) / 1000;
        const rate = elapsedSec > 0 ? done / elapsedSec : null;
        setProgress({
          done,
          total: list.length,
          rate,
          etaSec: rate > 0 ? Math.round((list.length - done) / rate) : null,
        });
      };

      // A small pool of workers, each pulling the next chunk. Cancellation is
      // checked between chunks so Stop does not wait for the whole queue.
      const worker = async () => {
        while (!cancelRef.current) {
          const index = cursor++;
          if (index >= chunks.length) return;
          await runChunk(chunks[index]);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(CHUNKS_IN_FLIGHT, chunks.length) }, worker),
      );

      const cancelled = cancelRef.current;
      cancelRef.current = false;
      setProgress(null);
      return { done, skipped, cancelled };
    },
    [probes],
  );

  const clearProbes = useCallback(async (models) => {
    try {
      await fetch("/api/models/probe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(models ? { models } : {}),
      });
    } catch {}
    setProbes((prev) => {
      if (!models) return {};
      const next = { ...prev };
      for (const m of models) delete next[m];
      return next;
    });
  }, []);

  return { probes, loaded, progress, probeAll, cancel, clearProbes };
}

export default useModelProbes;
