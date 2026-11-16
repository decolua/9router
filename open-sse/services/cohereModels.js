import { createHash } from "node:crypto";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import cohere from "../providers/registry/cohere.js";

const CATALOG_URL = "https://api.cohere.com/v1/models";
const catalogCache = new Map();
const seeds = new Map(cohere.models.map((model) => [model.id, model]));

// https://docs.cohere.com/reference/list-models does not expose per-key trial entitlements.
export function normalizeCohereModel(item) {
  if (!item || typeof item.name !== "string" || !item.name.trim() || item.is_deprecated === true) return null;
  const id = item.name.trim();
  const seed = seeds.get(id);
  const endpoints = Array.isArray(item.endpoints) ? item.endpoints : [];
  const kind = endpoints.includes("embed") ? "embedding"
    : endpoints.includes("chat") ? "llm"
      : endpoints.some((endpoint) => ["transcribe", "audio.transcriptions", "audio/transcriptions"].includes(endpoint)) || id.startsWith("cohere-transcribe-") ? "stt" : null;
  if (!kind) return null;
  const features = Array.isArray(item.features) ? item.features : [];
  const capabilities = { tools: false, vision: false, reasoning: false, ...seed?.capabilities };
  if (Number.isFinite(item.context_length) && item.context_length > 0) capabilities.contextWindow = item.context_length;
  for (const feature of features) {
    if (typeof feature !== "string") continue;
    if (/vision|image/i.test(feature)) capabilities.vision = true;
    if (/reason|thinking/i.test(feature)) capabilities.reasoning = true;
    if (/tool|function.call/i.test(feature)) capabilities.tools = true;
    if (/structured|json/i.test(feature)) capabilities.structuredOutput = true;
  }
  return {
    ...item,
    ...seed,
    id,
    name: seed?.name || id,
    kind,
    type: kind,
    capabilities,
    // Evaluation keys are free, not a declaration that a production key is unbilled.
    ...(typeof item.trial_eligible === "boolean" ? { trialEligible: item.trial_eligible } : {}),
  };
}

export async function resolveCohereModels(credentials, { proxyOptions = {}, forceRefresh = false, signal } = {}) {
  const token = credentials?.apiKey || credentials?.accessToken || credentials?.providerSpecificData?.apiKey;
  if (!token) throw Object.assign(new Error("Cohere API key is required"), { status: 401 });
  const key = createHash("sha256").update(JSON.stringify([token, proxyOptions])).digest("hex");
  const cached = catalogCache.get(key);
  if (!forceRefresh && cached?.expiresAt > Date.now()) return cached;
  const models = new Map();
  const pageTokens = new Set();
  let hasTranscriptionMetadata = false;
  let pageToken;
  do {
    const url = new URL(CATALOG_URL);
    url.searchParams.set("page_size", "1000");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const timeout = AbortSignal.timeout(20_000);
    const response = await proxyAwareFetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    }, proxyOptions);
    if (!response.ok) {
      throw Object.assign(new Error(`Cohere models request failed (${response.status})`), { status: response.status });
    }
    const data = await response.json();
    if (!Array.isArray(data?.models)) throw new Error("Invalid Cohere model catalog response");
    for (const item of data.models) {
      const model = normalizeCohereModel(item);
      if (model?.kind === "stt") hasTranscriptionMetadata = true;
      if (model && model.trialEligible !== false) models.set(model.id, model);
    }
    pageToken = data.next_page_token;
    if (pageToken && (typeof pageToken !== "string" || pageTokens.has(pageToken))) {
      throw new Error("Invalid Cohere catalog pagination token");
    }
    if (pageToken) pageTokens.add(pageToken);
  } while (pageToken);
  // ponytail: List Models' endpoint enum omits transcription; remove seeds when the catalog exposes STT.
  if (models.size && !hasTranscriptionMetadata) {
    for (const seed of cohere.models) {
      if (seed.kind === "stt") models.set(seed.id, { ...seed, type: "stt", capabilities: { audioInput: true, tools: false } });
    }
  }
  const entry = { models: [...models.values()], expiresAt: Date.now() + 5 * 60_000 };
  for (const [cacheKey, cachedEntry] of catalogCache) {
    if (cachedEntry.expiresAt <= Date.now()) catalogCache.delete(cacheKey);
  }
  if (!catalogCache.has(key) && catalogCache.size >= 128) catalogCache.delete(catalogCache.keys().next().value);
  catalogCache.set(key, entry);
  return entry;
}

export function clearCohereCatalog() {
  catalogCache.clear();
}
