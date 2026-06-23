/**
 * Shared headroom probe logic.
 *
 * probeHeadroom({ customUrl })
 *   → { source: 'custom'|'detected'|'unavailable', ok: boolean, url: string|null }
 *
 * probeHeadroomCached({ customUrl })
 *   Same result, cached for PROBE_RESULT_TTL_MS (20 s) to avoid re-probing on
 *   every /api/headroom/health + /api/headroom/stats request.
 *   Uses its own cache entry separate from probeCache (markDetected/wasDetected),
 *   which has a 10-min TTL and is used by the settings PATCH classifier.
 */

export const CANDIDATE_URLS = [
  "http://localhost:8787",
  "http://127.0.0.1:8787",
];

export const PROBE_TIMEOUT_MS = 1500;

// URL strings that are considered "default/auto-detect" targets — if the user's
// headroomUrl matches one of these, it is NOT treated as a custom URL.
const CANDIDATE_SET = new Set(CANDIDATE_URLS.map((u) => normalize(u)));

function normalize(url) {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/**
 * Probe a single URL to see if a headroom server is running there.
 * @param {string} url
 * @returns {Promise<{ ok: boolean, status?: number, data?: unknown, error?: string }>}
 */
export async function probeUrl(url) {
  const endpoint = `${String(url).replace(/\/$/, "")}/v1/compress`;
  const probeBody = {
    messages: [{ role: "user", content: "ping" }],
    model: "probe",
  };
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(probeBody),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json().catch(() => null);
    const looksLikeHeadroom =
      data &&
      (Array.isArray(data.messages) ||
        typeof data.tokens_saved === "number" ||
        typeof data.tokens_before === "number");
    return { ok: !!looksLikeHeadroom, status: res.status, data };
  } catch (e) {
    return { ok: false, error: e?.message || "unreachable" };
  }
}

/**
 * Resolve the active headroom backend by probing in priority order:
 *   1. customUrl — if provided AND not a default loopback candidate → source='custom'
 *   2. CANDIDATE_URLS (localhost:8787, 127.0.0.1:8787) → source='detected'
 *   3. nothing reachable → source='unavailable'
 *
 * Native is never reported (no native compressor exists).
 *
 * @param {{ customUrl?: string }} [opts]
 * @returns {Promise<{ source: 'custom'|'detected'|'unavailable', ok: boolean, url: string|null }>}
 */
export async function probeHeadroom({ customUrl } = {}) {
  // Only treat customUrl as "custom" if it is set and differs from the default
  // auto-detect candidates. A URL matching localhost:8787 / 127.0.0.1:8787 falls
  // through to the detected path so it is never labelled 'custom' by default.
  const normalizedCustom = customUrl ? normalize(customUrl) : null;
  const isReallyCustom =
    normalizedCustom && !CANDIDATE_SET.has(normalizedCustom);

  if (isReallyCustom) {
    const result = await probeUrl(normalizedCustom);
    if (result.ok) {
      return { source: "custom", ok: true, url: normalizedCustom };
    }
    // Custom URL unreachable — fall through to auto-detect
  }

  // Auto-detect: probe candidates in order
  for (const candidate of CANDIDATE_URLS) {
    const result = await probeUrl(candidate);
    if (result.ok) {
      return { source: "detected", ok: true, url: candidate };
    }
  }

  return { source: "unavailable", ok: false, url: null };
}

// --- Short-TTL cached variant (20 s) for health/stats routes ---

const PROBE_RESULT_TTL_MS = 20_000;

let _cachedResult = null;
let _cacheKey = "";
let _cacheTs = 0;

/**
 * Like probeHeadroom but caches the result for PROBE_RESULT_TTL_MS.
 * Cache is keyed on customUrl so a settings change busts it automatically.
 * @param {{ customUrl?: string }} [opts]
 * @returns {Promise<{ source: 'custom'|'detected'|'unavailable', ok: boolean, url: string|null }>}
 */
export async function probeHeadroomCached({ customUrl } = {}) {
  const key = customUrl ?? "";
  const now = Date.now();
  if (_cachedResult && _cacheKey === key && now - _cacheTs < PROBE_RESULT_TTL_MS) {
    return _cachedResult;
  }
  const result = await probeHeadroom({ customUrl });
  _cachedResult = result;
  _cacheKey = key;
  _cacheTs = now;
  return result;
}

/** Reset the short-TTL probe cache (for testing). */
export function _resetProbeCache() {
  _cachedResult = null;
  _cacheKey = "";
  _cacheTs = 0;
}
