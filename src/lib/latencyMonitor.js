/**
 * Provider latency tracking and monitoring.
 * Records per-provider response latency for intelligent provider selection.
 * Issue #3072: Feature Request: Latency Monitoring for Provider Selection
 */

import { appendRequestLog } from "@/lib/usageDb.js";

const LATENCY_WINDOW_MS = 5 * 60 * 1000; // 5 min rolling window
const MAX_SAMPLES = 100;

// { [providerKey]: { samples: [{ ttft, total, ts }], rollingAvg: { ttft, total } } }
const latencyStore = new Map();

function providerKey(provider, model) {
  return `${provider}/${model || "*"}`;
}

/**
 * Record a latency sample for a provider/model.
 * @param {string} provider
 * @param {string} model
 * @param {{ttft: number, total: number}} latency
 */
export function recordLatency(provider, model, latency) {
  if (!provider || !latency) return;
  const key = providerKey(provider, model);
  const now = Date.now();
  const { ttft = 0, total = 0 } = latency;

  let entry = latencyStore.get(key);
  if (!entry) {
    entry = { samples: [], rollingAvg: { ttft: 0, total: 0 } };
    latencyStore.set(key, entry);
  }

  entry.samples.push({ ttft, total, ts: now });

  // Trim: remove entries older than window, cap to MAX_SAMPLES
  const cutoff = now - LATENCY_WINDOW_MS;
  entry.samples = entry.samples.filter(s => s.ts >= cutoff).slice(-MAX_SAMPLES);

  // Recalculate rolling average
  if (entry.samples.length > 0) {
    const sum = entry.samples.reduce(
      (acc, s) => ({ ttft: acc.ttft + s.ttft, total: acc.total + s.total }),
      { ttft: 0, total: 0 }
    );
    entry.rollingAvg = {
      ttft: Math.round(sum.ttft / entry.samples.length),
      total: Math.round(sum.total / entry.samples.length),
      samples: entry.samples.length,
    };
  }
}

/**
 * Get latency stats for a specific provider/model.
 * @param {string} provider
 * @param {string} model
 * @returns {{ttft: number, total: number, samples: number} | null}
 */
export function getLatency(provider, model) {
  const entry = latencyStore.get(providerKey(provider, model));
  if (!entry || entry.samples.length === 0) return null;
  return entry.rollingAvg;
}

/**
 * Get all latency stats, sorted by fastest TTFT.
 * @returns {Array<{provider: string, model: string, ttft: number, total: number, samples: number}>}
 */
export function getAllLatencyStats() {
  const result = [];
  for (const [key, entry] of latencyStore) {
    if (entry.samples.length === 0) continue;
    const [provider, model] = key.split("/");
    result.push({
      provider,
      model: model === "*" ? null : model,
      ...entry.rollingAvg,
    });
  }
  return result.sort((a, b) => a.ttft - b.ttft);
}

/**
 * Pick the fastest provider from a list of candidates.
 * Falls back to first if no latency data exists.
 * @param {Array<{provider: string, model?: string}>} candidates
 * @returns {{provider: string, model?: string} | null}
 */
export function pickFastestProvider(candidates) {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  let best = null;
  let bestTtft = Infinity;
  for (const c of candidates) {
    const lat = getLatency(c.provider, c.model);
    if (lat && lat.ttft < bestTtft) {
      bestTtft = lat.ttft;
      best = c;
    }
  }
  return best || candidates[0];
}
