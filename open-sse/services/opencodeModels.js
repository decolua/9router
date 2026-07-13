/**
 * Live model resolver for OpenCode Free (noAuth).
 * Fetches https://opencode.ai/zen/v1/models — no credentials needed.
 */

const MODELS_URL = "https://opencode.ai/zen/v1/models";
const TIMEOUT_MS = 5000;

let _cache = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

export function clearOpencodeModelsCache() {
  _cache = null;
  _cacheAt = 0;
}

/**
 * @returns {{ models: { id: string }[] } | null}
 */
export async function resolveOpencodeModels() {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_TTL_MS) return _cache;

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(MODELS_URL, {
      headers: { "x-opencode-client": "desktop" },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return null;

    const data = await res.json();
    // Response shape: { data: [{ id, ... }] } (OpenAI-style) or [{ id }]
    const raw = Array.isArray(data) ? data : (data?.data || data?.models || []);
    const models = raw
      .map((m) => ({ id: m?.id || m?.name }))
      .filter((m) => typeof m.id === "string" && m.id.trim() !== "");

    if (!models.length) return null;

    _cache = { models };
    _cacheAt = now;
    return _cache;
  } catch {
    return null;
  }
}
