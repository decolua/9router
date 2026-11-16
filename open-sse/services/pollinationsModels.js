import { createHash } from "node:crypto";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

export const POLLINATIONS_MODELS_URL = "https://gen.pollinations.ai/v1/models";
const cache = new Map();
const TTL_MS = 5 * 60 * 1000;
const tokenOf = (credentials) => credentials?.apiKey || credentials?.accessToken || "";

export function pollinationsHeaders(credentials) {
  const token = tokenOf(credentials);
  if (typeof token !== "string" || !/^sk_\S+$/.test(token)) {
    throw Object.assign(new Error("Pollinations requires a secret sk_ API key; pk_ App Keys do not authenticate generation requests"), { status: 401 });
  }
  return { Authorization: `Bearer ${token}` };
}

async function readJson(response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(data?.error?.message || `Pollinations request failed (${response.status})`), { status: response.status });
  if (!data) throw Object.assign(new Error("Invalid Pollinations JSON response"), { status: 502 });
  return data;
}

export async function validatePollinationsKey(credentials, { proxyOptions = {}, fetchImpl = proxyAwareFetch } = {}) {
  const headers = pollinationsHeaders(credentials);
  const response = await fetchImpl("https://gen.pollinations.ai/account/key", {
    headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(15000),
  }, proxyOptions);
  const info = await readJson(response);
  if (info.valid !== true || info.type !== "secret") throw Object.assign(new Error("Pollinations API key is not an active secret key"), { status: 401 });
  return info;
}

export function parsePollinationsModels(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(rows)) throw Object.assign(new Error("Invalid Pollinations model catalog"), { status: 502 });
  const seen = new Set();
  return rows.flatMap((row) => {
    const id = row?.id || row?.name;
    if (typeof id !== "string" || !id || row.paid_only !== false || seen.has(id)) return [];
    const endpoints = Array.isArray(row.supported_endpoints) ? row.supported_endpoints : [];
    let kind;
    switch (row.category) {
      case "text": if (endpoints.includes("/v1/chat/completions")) kind = "llm"; break;
      case "decision": if (endpoints.includes("/alpha/decisions") || endpoints.includes("/v1/systemone")) kind = "systemone"; break;
      case "embedding": if (endpoints.includes("/v1/embeddings")) kind = "embedding"; break;
      case "image": if (endpoints.includes("/v1/images/generations")) kind = "image"; break;
      case "video": if (endpoints.includes("/video/{prompt}")) kind = "video"; break;
      case "realtime": if (endpoints.includes("/v1/realtime")) kind = "realtime"; break;
      case "audio":
        if (endpoints.includes("/v1/audio/transcriptions")) kind = "stt";
        else if (endpoints.includes("/v1/audio/speech")) kind = "tts";
        break;
    }
    // Only modalities exposed by 9Router are discoverable (no local 3D route).
    if (!kind) return [];
    seen.add(id);
    const input = Array.isArray(row.input_modalities) ? row.input_modalities : [];
    const capabilities = new Set(Array.isArray(row.capabilities) ? row.capabilities : []);
    if (input.includes("image")) capabilities.add("vision");
    if (row.tools) capabilities.add("tool_calling");
    if (row.reasoning) capabilities.add("reasoning");
    if (row.supported_parameters?.includes("response_format")) capabilities.add("structured_outputs");
    if (kind === "llm" && row.supports_streaming !== false) capabilities.add("streaming");
    if (endpoints.includes("/v1/images/edits")) capabilities.add("image_edit");
    return [{ ...row, id, name: row.title || id, kind, aliases: Array.isArray(row.aliases) ? row.aliases : [],
      upstreamCapabilities: [...capabilities],
      capabilities: {
        vision: input.includes("image"), pdf: input.includes("image"), audioInput: input.includes("audio"),
        videoInput: input.includes("video"), imageOutput: row.output_modalities?.includes("image") || false,
        audioOutput: row.output_modalities?.includes("audio") || false, tools: capabilities.has("tool_calling"),
        reasoning: capabilities.has("reasoning"), streaming: capabilities.has("streaming"),
        structuredOutputs: capabilities.has("structured_outputs"), imageEdit: capabilities.has("image_edit"),
        contextWindow: row.context_length, maxOutput: row.top_provider?.max_completion_tokens ?? undefined,
      }, contextLength: row.context_length,
      maxOutputTokens: row.top_provider?.max_completion_tokens ?? undefined,
      isVL: input.includes("image"), isReasoning: capabilities.has("reasoning"), freeTierEligible: true }];
  });
}

export async function resolvePollinationsModels(credentials = {}, { proxyOptions = {}, forceRefresh = false, fetchImpl = proxyAwareFetch } = {}) {
  const token = tokenOf(credentials);
  const key = createHash("sha256").update(JSON.stringify([token, proxyOptions])).digest("hex");
  const cached = cache.get(key);
  if (!forceRefresh && cached?.expiresAt > Date.now()) return cached;
  // Catalog access is public; with a secret key it also respects model permissions.
  const headers = { Accept: "application/json", ...(token ? pollinationsHeaders(credentials) : {}) };
  const response = await fetchImpl(POLLINATIONS_MODELS_URL, { headers, signal: AbortSignal.timeout(15000) }, proxyOptions);
  const models = parsePollinationsModels(await readJson(response));
  const isFree = (model) => {
    const prices = Object.entries(model.pricing || {}).filter(([key]) => key !== "currency");
    return (prices.length > 0 || model.pricing?.currency === "pollen") && prices.every(([, value]) =>
      (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) && Number(value) === 0);
  };
  const result = {
    models: models.filter(isFree),
    suggestedModels: models.filter((model) => !isFree(model)),
    expiresAt: Date.now() + TTL_MS,
  };
  for (const [entryKey, entry] of cache) if (entry.expiresAt <= Date.now()) cache.delete(entryKey);
  if (cache.size >= 128) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}

export function clearPollinationsCatalog() { cache.clear(); }
