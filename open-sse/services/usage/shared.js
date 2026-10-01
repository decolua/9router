/**
 * Shared usage helpers (cross-provider)
 */

import { PROVIDERS } from "../../providers/index.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";

// usage endpoints: single source from registry transport.usage
export const U = (id) => PROVIDERS[id]?.usage || {};

/**
 * Parse reset date/time to ISO string
 * Handles multiple formats: Unix timestamp (ms), ISO date string, etc.
 */
export function parseResetTime(resetValue) {
  if (!resetValue) return null;

  try {
    // If it's already a Date object
    if (resetValue instanceof Date) {
      return resetValue.toISOString();
    }

    // Unix timestamps from provider APIs may be seconds or milliseconds.
    if (typeof resetValue === 'number') {
      return new Date(resetValue < 1e12 ? resetValue * 1000 : resetValue).toISOString();
    }

    // If it's a numeric string, treat it like a Unix timestamp too.
    if (typeof resetValue === 'string') {
      if (/^\d+$/.test(resetValue)) {
        const timestamp = Number(resetValue);
        return new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp).toISOString();
      }
      return new Date(resetValue).toISOString();
    }

    return null;
  } catch (error) {
    console.warn(`Failed to parse reset time: ${resetValue}`, error);
    return null;
  }
}

export function toFiniteNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function normalizeCloudCodeProjectId(project) {
  if (typeof project === "string") return project.trim() || null;
  if (project && typeof project === "object" && typeof project.id === "string") {
    return project.id.trim() || null;
  }
  return null;
}

export async function fetchWithTimeout(url, opts, ms = 10000, proxyOptions = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    return await proxyAwareFetch(url, { ...opts, signal: controller.signal }, proxyOptions);
  } finally {
    clearTimeout(timeoutId);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch with timeout and bounded retry for TRANSIENT failures only.
 *
 * Usage/quota endpoints are secondary services that intermittently return 5xx
 * (e.g. CodeBuddy's billing gateway) or drop the connection. Without a retry a
 * single hiccup surfaces to the operator as a hard "quota API error (500)" even
 * though the credential and request are fine. Retry 5xx and network errors a
 * few times with a short backoff; NEVER retry 4xx (a 401/403/404 is a real,
 * deterministic answer — retrying only wastes the provider's rate budget).
 *
 * @returns {Promise<Response>} the last response (caller still checks .ok)
 */
export async function fetchWithRetry(url, opts, { attempts = 3, timeoutMs = 10000, proxyOptions = null, backoffMs = 400 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetchWithTimeout(url, opts, timeoutMs, proxyOptions);
      if (res.status < 500) return res; // success or a deterministic client error
      lastError = new Error(`HTTP ${res.status}`);
      // Last attempt: hand the 5xx response back so the caller can report the code.
      if (attempt === attempts) return res;
    } catch (err) {
      lastError = err; // timeout / network error — retryable
      if (attempt === attempts) throw lastError;
    }
    await sleep(backoffMs * attempt);
  }
  throw lastError;
}

