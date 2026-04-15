// Fetch and cache suggested models for providers that expose a public models API
// Fetches via backend proxy to avoid CORS issues

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map(); // key: fetcher.url → { data, expiresAt }

/**
 * Fetch suggested models for a provider using its modelsFetcher config.
 * Results are cached in-memory for CACHE_TTL_MS.
 * @param {{ url: string, type: string }} fetcher
 * @returns {Promise<Array<{ id: string, name: string, contextLength?: number }>>}
 */
export async function fetchSuggestedModels(fetcher) {
  if (!fetcher?.url || !fetcher?.type) return [];

  const cached = cache.get(fetcher.url);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  try {
    const params = new URLSearchParams({ url: fetcher.url, type: fetcher.type });
    const res = await fetch(`/api/providers/suggested-models?${params}`);
    if (!res.ok) return [];
    const json = await res.json();
    const data = json.data ?? [];
    cache.set(fetcher.url, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch {
    return [];
  }
}
