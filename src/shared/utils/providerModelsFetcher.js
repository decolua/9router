// Fetch and cache suggested models for providers that expose a public models API
// Fetches via backend proxy to avoid CORS issues

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map(); // key: fetcher.url → { data, expiresAt }

/**
 * Fetch suggested models for a provider using its modelsFetcher config.
 * Results are cached in-memory for CACHE_TTL_MS.
 * A list of fetchers is merged by model id, the first source winning a model listed by several
 * (DotHoosh lists DeepSeek on both its OpenAI and Anthropic routes); each source keeps its own
 * cache and last good list, so one failing source never drops the others.
 * @param {{ url: string, type: string } | Array<{ url: string, type: string }>} fetcher
 * @returns {Promise<Array<{ id: string, name: string, contextLength?: number, maxOutput?: number, vision?: boolean, protocols?: string[] }>>}
 */
export async function fetchSuggestedModels(fetcher) {
  if (Array.isArray(fetcher)) {
    const lists = await Promise.all(fetcher.map((source) => fetchSuggestedModels(source)));
    const seen = new Set();
    return lists.flat().filter((model) => !seen.has(model.id) && seen.add(model.id));
  }
  if (!fetcher?.url || !fetcher?.type) return [];

  const cached = cache.get(fetcher.url);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  // An outage or a malformed body reaches us as an empty list. That is never an answer worth
  // keeping: serve the last good list instead and ask again next time.
  const keepPrevious = () => (cached ? cached.data : []);

  try {
    const params = new URLSearchParams({ url: fetcher.url, type: fetcher.type });
    const res = await fetch(`/api/providers/suggested-models?${params}`);
    if (!res.ok) return keepPrevious();
    const json = await res.json();
    const data = Array.isArray(json?.data) ? json.data : [];
    if (data.length === 0) return keepPrevious();
    cache.set(fetcher.url, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch {
    return keepPrevious();
  }
}
