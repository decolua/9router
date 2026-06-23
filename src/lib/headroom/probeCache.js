/**
 * In-process cache of URLs that were positively identified by /api/headroom/probe.
 * Probe route writes here; settings PATCH reads to classify headroomSource.
 * TTL: 10 minutes — stale entries decay without requiring a restart.
 */

const DETECTED_TTL_MS = 10 * 60 * 1000;

// Map<normalizedUrl, timestampMs>
const _cache = new Map();

/**
 * Record a URL as successfully auto-detected by the probe.
 * @param {string} url
 */
export function markDetected(url) {
  if (!url) return;
  _cache.set(normalize(url), Date.now());
}

/**
 * Return true if `url` was auto-detected by the probe within the TTL window.
 * @param {string} url
 * @returns {boolean}
 */
export function wasDetected(url) {
  if (!url) return false;
  const ts = _cache.get(normalize(url));
  if (!ts) return false;
  if (Date.now() - ts > DETECTED_TTL_MS) {
    _cache.delete(normalize(url));
    return false;
  }
  return true;
}

function normalize(url) {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}
