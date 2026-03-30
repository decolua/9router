// Fetch and cache suggested models for providers that expose a public models API
// Designed to be extensible: add new types in FILTERS below

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map(); // key: fetcher.url → { data, expiresAt }

const FILTERS = {
  // Free models with context >= 200k tokens
  "openrouter-free": (models) =>
    models
      .filter(
        (m) =>
          m.pricing?.prompt === "0" &&
          m.pricing?.completion === "0" &&
          m.context_length >= 200000
      )
      .map((m) => ({ id: m.id, name: m.name, contextLength: m.context_length }))
      .sort((a, b) => b.contextLength - a.contextLength),
};

/**
 * Fetch suggested models for a provider using its modelsFetcher config.
 * Results are cached in-memory for CACHE_TTL_MS.
 * @param {{ url: string, type: string }} fetcher
 * @returns {Promise<Array<{ id: string, name: string, contextLength: number }>>}
 */
export async function fetchSuggestedModels(fetcher) {
  if (!fetcher?.url || !fetcher?.type) return [];

  const cached = cache.get(fetcher.url);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  try {
    const res = await fetch(fetcher.url);
    if (!res.ok) return [];
    const json = await res.json();
    const raw = json.data ?? json.models ?? json;
    const filter = FILTERS[fetcher.type];
    const data = filter ? filter(Array.isArray(raw) ? raw : []) : [];
    cache.set(fetcher.url, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch {
    return [];
  }
}
