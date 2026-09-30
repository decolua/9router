// Fetch and cache suggested models for providers that expose a public models API
// Fetches via backend proxy to avoid CORS issues

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map(); // key: fetcher.url → { data, expiresAt }

/**
 * Fetch suggested models for a provider using its modelsFetcher config.
 * Results are cached in-memory for CACHE_TTL_MS. Upstream failures are not
 * cached; the backend may answer with built-in fallback models plus an error
 * note instead of failing silently.
 * @param {{ url: string, type: string }} fetcher
 * @returns {Promise<{ data: Array<{ id: string, name: string, contextLength?: number }>, error: string | null }>}
 */
export async function fetchSuggestedModels(fetcher) {
  if (!fetcher?.url || !fetcher?.type) return { data: [], error: null };

  const cached = cache.get(fetcher.url);
  if (cached && Date.now() < cached.expiresAt) return { data: cached.data, error: null };

  try {
    const params = new URLSearchParams({ url: fetcher.url, type: fetcher.type });
    const res = await fetch(`/api/providers/suggested-models?${params}`);
    const json = await res.json().catch(() => null);
    const data = Array.isArray(json?.data) ? json.data : [];
    const error =
      typeof json?.error === "string" && json.error
        ? json.error
        : res.ok
          ? null
          : "Could not load suggested models.";
    if (!error) {
      cache.set(fetcher.url, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return { data, error };
  } catch {
    return { data: [], error: "Could not load suggested models." };
  }
}
