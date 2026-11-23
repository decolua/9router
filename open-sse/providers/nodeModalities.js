// Media input a user-defined compatible node reports for its own models.
//
// A node (openai-compatible-* or anthropic-compatible-*) usually serves models
// no capability table knows, so getCapabilitiesForModel falls to
// DEFAULT_CAPABILITIES (vision:false) and stripUnsupportedModalities replaces
// every image with a placeholder before the request leaves the router, even
// when the server says the model reads images. This asks the node what it
// serves and only ever turns a capability ON.
//
// Sources, first that answers wins (all are cached per node):
//   1. GET {baseUrl}/models — the standard list; reads the common shapes:
//        input_modalities                vLLM-style servers, MLX-Serve
//        architecture.input_modalities   OpenRouter-style gateways
//        modalities.input                models.dev-style catalogs
//        capabilities: ["vision", ...]   capability lists
//   2. GET {origin}/api/v0/models — LM Studio native list (type "vlm"), used
//      only when the standard list declares nothing.
//   3. POST {origin}/api/show {model} — Ollama, per model (capabilities), used
//      only when neither list knows the model.
// A source that is missing or unreachable is skipped until the TTL expires.

const TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 3000;
const NODE_PREFIXES = ["openai-compatible-", "anthropic-compatible-"];
const cache = new Map(); // provider -> { at, models: Map<modelId, caps>, listed: boolean }
const shown = new Map(); // `${provider}\n${model}` -> { at, caps|null }
const inflight = new Map();

const lower = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => x.toLowerCase()) : []);
const isNode = (provider) => NODE_PREFIXES.some((p) => provider?.startsWith?.(p));

// One model entry -> { vision?, audioInput?, pdf? } (true only), or null when the
// entry declares nothing about its inputs.
export function modalitiesFromModelEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const input = [
    ...lower(entry.input_modalities),
    ...lower(entry.architecture?.input_modalities),
    ...lower(entry.modalities?.input),
  ];
  const capsList = lower(entry.capabilities);
  const type = typeof entry.type === "string" ? entry.type.toLowerCase() : "";
  if (type === "vlm") capsList.push("vision"); // LM Studio
  if (!input.length && !capsList.length) return null;
  const out = {};
  if (input.includes("image") || capsList.includes("vision")) out.vision = true;
  if (input.includes("audio") || capsList.includes("audio")) out.audioInput = true;
  if (input.includes("pdf") || input.includes("file")) out.pdf = true;
  return out;
}

function headersFor(provider, apiKey) {
  const h = { accept: "application/json" };
  if (apiKey) {
    if (provider.startsWith("anthropic-compatible-")) h["x-api-key"] = apiKey;
    else h.authorization = `Bearer ${apiKey}`;
  }
  return h;
}

async function getJson(fetchImpl, url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function collect(list, into) {
  for (const entry of Array.isArray(list) ? list : []) {
    const id = entry?.id || entry?.name || entry?.model;
    const caps = modalitiesFromModelEntry(entry);
    if (id && caps) into.set(String(id), caps);
  }
}

const trimBase = (baseUrl) => String(baseUrl).replace(/\/+$/, "");
const originOf = (baseUrl) => trimBase(baseUrl).replace(/\/v\d+$/, "");

async function loadLists(provider, baseUrl, apiKey, fetchImpl) {
  const headers = headersFor(provider, apiKey);
  const models = new Map();
  const std = await getJson(fetchImpl, `${trimBase(baseUrl)}/models`, { headers });
  collect(std?.data || std?.models, models);
  if (!models.size) {
    const lms = await getJson(fetchImpl, `${originOf(baseUrl)}/api/v0/models`, { headers });
    collect(lms?.data, models);
  }
  cache.set(provider, { at: Date.now(), models });
}

async function loadShow(key, provider, baseUrl, apiKey, model, fetchImpl) {
  const headers = { ...headersFor(provider, apiKey), "content-type": "application/json" };
  const res = await getJson(fetchImpl, `${originOf(baseUrl)}/api/show`, { method: "POST", headers, body: JSON.stringify({ model }) });
  shown.set(key, { at: Date.now(), caps: modalitiesFromModelEntry(res) });
}

function once(key, start) {
  if (!inflight.has(key)) inflight.set(key, start().finally(() => inflight.delete(key)));
  return inflight.get(key);
}

const fresh = (e) => e && Date.now() - e.at <= TTL_MS;

/**
 * Capabilities the node reports for `model`, or null.
 * @param {string} provider - openai-compatible-* / anthropic-compatible-* provider id
 * @param {string} model - model id as the node serves it
 * @param {object} credentials - connection credentials (providerSpecificData.baseUrl, apiKey)
 */
export async function getNodeReportedModalities(provider, model, credentials, fetchImpl = globalThis.fetch) {
  if (!isNode(provider) || !model) return null;
  const baseUrl = credentials?.providerSpecificData?.baseUrl;
  if (!baseUrl || typeof fetchImpl !== "function") return null;
  const apiKey = credentials?.apiKey;
  const id = String(model);

  if (!fresh(cache.get(provider))) await once(provider, () => loadLists(provider, baseUrl, apiKey, fetchImpl));
  const listed = cache.get(provider)?.models.get(id);
  if (listed) return listed;

  const key = `${provider}\n${id}`;
  if (!fresh(shown.get(key))) await once(key, () => loadShow(key, provider, baseUrl, apiKey, id, fetchImpl));
  return shown.get(key)?.caps || null;
}

// Merge node-reported support over table capabilities (never turns one off).
export function withNodeModalities(caps, reported) {
  if (!reported) return caps;
  const out = { ...caps };
  for (const key of ["vision", "audioInput", "pdf"]) if (reported[key] === true) out[key] = true;
  return out;
}

export function _resetNodeModalitiesCache() {
  cache.clear();
  shown.clear();
  inflight.clear();
}
