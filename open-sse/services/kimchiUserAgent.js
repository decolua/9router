export const KIMCHI_CLI_RELEASE_URL = "https://api.github.com/repos/getkimchi/kimchi/releases/latest";
export const KIMCHI_FALLBACK_CLI_VERSION = "0.1.53";
export const KIMCHI_VERSION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let cachedVersion = KIMCHI_FALLBACK_CLI_VERSION;
let cacheExpiresAt = 0;
let refreshPromise = null;

export function normalizeKimchiCliVersion(value) {
  if (typeof value !== "string") return null;
  const version = value.trim().replace(/^v/i, "");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) return null;
  return version;
}

export function buildKimchiUserAgent(version = cachedVersion || KIMCHI_FALLBACK_CLI_VERSION) {
  const normalized = normalizeKimchiCliVersion(version) || KIMCHI_FALLBACK_CLI_VERSION;
  return `kimchi/${normalized}`;
}

export function resetKimchiCliVersionCache() {
  cachedVersion = KIMCHI_FALLBACK_CLI_VERSION;
  cacheExpiresAt = 0;
  refreshPromise = null;
}

async function fetchLatestKimchiCliVersion(fetchImpl, signal) {
  const response = await fetchImpl(KIMCHI_CLI_RELEASE_URL, {
    method: "GET",
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "9router",
    },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Kimchi release lookup failed: ${response.status}`);
  }
  const data = await response.json();
  const version = normalizeKimchiCliVersion(data?.tag_name || data?.name);
  if (!version) throw new Error("Kimchi release lookup returned no valid version");
  return version;
}

export async function refreshKimchiCliVersion(options = {}) {
  const now = options.now || Date.now();
  if (!options.force && cacheExpiresAt > now) return cachedVersion;
  if (refreshPromise) return refreshPromise;

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") return cachedVersion || KIMCHI_FALLBACK_CLI_VERSION;

  refreshPromise = (async () => {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs || 5000;
    const timer = setTimeout(() => controller.abort(new Error("Kimchi release lookup timeout")), timeoutMs);

    try {
      const signal = options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal;
      cachedVersion = await fetchLatestKimchiCliVersion(fetchImpl, signal);
    } catch (error) {
      options.log?.warn?.("KIMCHI_VERSION", error.message);
      cachedVersion = cachedVersion || KIMCHI_FALLBACK_CLI_VERSION;
    } finally {
      clearTimeout(timer);
      cacheExpiresAt = now + KIMCHI_VERSION_CACHE_TTL_MS;
      refreshPromise = null;
    }

    return cachedVersion || KIMCHI_FALLBACK_CLI_VERSION;
  })();

  return refreshPromise;
}
