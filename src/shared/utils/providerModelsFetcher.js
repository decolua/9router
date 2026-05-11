// Fetch and cache suggested models for providers that expose a public models API
// Fetches via backend proxy to avoid CORS issues

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map(); // key: fetcher.url → { data, expiresAt }

/**
 * Fetch suggested models for a provider using its modelsFetcher config.
 * Results are cached in-memory for CACHE_TTL_MS.
 * @param {{ url: string, type: string }} fetcher
 * @returns {Promise<{ data: Array<{ id: string, name: string, contextLength?: number }>, error: string | null }>}
 */
export async function fetchProviderModelCatalog(fetcher) {
  if (!fetcher?.url || !fetcher?.type) return { data: [], error: "Missing models fetcher config" };

  const cached = cache.get(fetcher.url);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  try {
    const params = new URLSearchParams({ url: fetcher.url, type: fetcher.type });
    const res = await fetch(`/api/providers/suggested-models?${params}`);
    if (!res.ok) return { data: [], error: `Failed to fetch provider models: ${res.status}` };
    const json = await res.json();
    const result = { data: json.data ?? [], error: json.error ?? null };
    cache.set(fetcher.url, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (error) {
    return { data: [], error: error?.message || "Failed to fetch provider models" };
  }
}

/**
 * Fetch suggested models for a provider using its modelsFetcher config.
 * Preserves the legacy array-only return shape for existing callers.
 * @param {{ url: string, type: string }} fetcher
 * @returns {Promise<Array<{ id: string, name: string, contextLength?: number }>>}
 */
export async function fetchSuggestedModels(fetcher) {
  const result = await fetchProviderModelCatalog(fetcher);
  return result.data;
}
