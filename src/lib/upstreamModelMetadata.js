/**
 * Upstream Model Metadata — fetch model capabilities (contextWindow, maxOutput,
 * vision, reasoning) from live provider /models endpoints, with a short-lived
 * in-memory cache so we don't hammer upstream on every request.
 *
 * Most providers' /models endpoints return only {id, object, created, owned_by}
 * — NO context window. For those, the parser returns null and callers fall back
 * to the static getCapabilitiesForModel() pattern matcher.
 *
 * Providers that DO return useful metadata:
 *   gemini  — inputTokenLimit / outputTokenLimit
 *   github  — capabilities.limits.max_context_window / max_output_tokens
 *   kiro    — contextLength (via existing resolveKiroModels)
 *   qoder   — contextLength / maxOutputTokens / isVL / isReasoning
 *
 * Custom openai-compatible-* / anthropic-compatible-* providers: we check for
 * extended fields (context_window, max_tokens, etc.) in the upstream response.
 * Some third-party gateways (LiteLLM, OpenRouter, etc.) include them.
 */

let resolveKiroModels;
let resolveQoderModels;
// Optional resolvers — loaded lazily so the module works even when
// these packages aren't installed (they're in open-sse/).
try {
  const kiro = await import("open-sse/services/kiroModels.js");
  resolveKiroModels = kiro.resolveKiroModels;
} catch { /* kiro resolver unavailable */ }
try {
  const qoder = await import("open-sse/services/qoderModels.js");
  resolveQoderModels = qoder.resolveQoderModels;
} catch { /* qoder resolver unavailable */ }

// ── Cache ──────────────────────────────────────────────────────────────

/** @type {Map<string, { expiresAt: number, models: Map<string, object> }>} */
const providerCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;   // 5 minutes
const FETCH_TIMEOUT_MS = 5000;        // 5 seconds

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Synchronous cache lookup. Returns a partial capabilities object (only the
 * fields the upstream provided) or null if not cached / expired.
 *
 * @param {string} providerId
 * @param {string} modelId
 * @returns {object|null}
 */
export function getCachedUpstreamCapabilities(providerId, modelId) {
  const entry = providerCache.get(providerId);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.models.get(modelId) || null;
}

/**
 * Try to extract and cache capabilities from a raw upstream /models response
 * that was already fetched (e.g. in fetchCompatibleModelIds). Only caches
 * if extended metadata fields are detected.
 *
 * @param {string} providerId
 * @param {object[]} rawModels — full model objects from upstream
 */
export function tryCacheFromRawResponse(providerId, rawModels) {
  if (!Array.isArray(rawModels) || rawModels.length === 0) return;
  const parsed = parseExtendedOpenAIStyleModels(rawModels);
  if (!parsed) return;
  providerCache.set(providerId, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    models: parsed,
  });
}

/**
 * Fetch upstream /models for a provider connection, parse metadata, and
 * populate the cache. Returns Map<modelId, partialCaps> on success, null on
 * any failure (timeout, network error, auth failure, no metadata in response).
 *
 * @param {object} connection — provider connection record
 * @returns {Promise<Map<string, object>|null>}
 */
export async function fetchAndCacheUpstreamModels(connection) {
  const providerId = connection?.provider;
  if (!providerId) return null;

  const fetcher = getProviderFetcher(providerId);
  if (!fetcher) return null;

  let models;
  try {
    models = await fetcher(connection);
  } catch {
    return null;
  }
  if (!models || models.size === 0) return null;

  providerCache.set(providerId, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    models,
  });
  return models;
}

// ── Provider Fetcher Dispatch ───────────────────────────────────────────

/**
 * Return a fetcher function for the given providerId, or null if this provider
 * type doesn't expose useful metadata in its /models endpoint.
 */
function getProviderFetcher(providerId) {
  // ── providers with known metadata-rich endpoints ──
  if (providerId === "gemini") return fetchGeminiModels;
  if (providerId === "github") return fetchGitHubModels;
  if (providerId === "kiro" && resolveKiroModels) return fetchKiroModels;
  if (providerId === "qoder" && resolveQoderModels) return fetchQoderModels;

  // ── custom compatible providers — try extended-field parsing ──
  if (providerId.startsWith("openai-compatible-")) return fetchOpenAICompatibleModels;
  if (providerId.startsWith("anthropic-compatible-")) return fetchAnthropicCompatibleModels;

  // ── built-in providers with standard OpenAI-shaped /models ──
  // These return {id, object, created, owned_by} with no context window.
  // We still try in case the upstream has been extended.
  if (BUILTIN_OPENAI_STYLE.has(providerId)) return fetchOpenAIStyleModels;

  return null;
}

/** Built-in providers whose /models endpoint is OpenAI-shaped but may vary. */
const BUILTIN_OPENAI_STYLE = new Set([
  "openai", "deepseek", "groq", "xai", "mistral", "perplexity",
  "together", "fireworks", "cerebras", "cohere", "nebius",
  "siliconflow", "hyperbolic", "openrouter", "qwen", "alicode",
  "alicode-intl", "volcengine-ark", "byteplus",
]);

// ── Per-Provider Fetchers ──────────────────────────────────────────────

/**
 * Gemini: GET https://generativelanguage.googleapis.com/v1beta/models?key=API_KEY
 * Returns models[] with inputTokenLimit / outputTokenLimit.
 */
async function fetchGeminiModels(connection) {
  const apiKey = connection.apiKey || connection.accessToken;
  if (!apiKey) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const response = await fetchWithTimeout(url, { headers: { "Content-Type": "application/json" } });
  if (!response.ok) return null;

  const data = await response.json();
  const rawModels = data?.models;
  if (!Array.isArray(rawModels)) return null;

  const map = new Map();
  for (const m of rawModels) {
    const id = m?.name?.replace(/^models\//, "") || m?.name;
    if (!id) continue;
    /** @type {object} */
    const caps = {};
    if (typeof m.inputTokenLimit === "number") caps.contextWindow = m.inputTokenLimit;
    if (typeof m.outputTokenLimit === "number") caps.maxOutput = m.outputTokenLimit;
    if (Object.keys(caps).length > 0) map.set(id, caps);
  }
  return map.size > 0 ? map : null;
}

/**
 * GitHub Copilot: GET https://api.githubcopilot.com/models
 * Returns data[] with capabilities.limits.max_context_window / max_output_tokens.
 */
async function fetchGitHubModels(connection) {
  const token = connection.accessToken || connection.apiKey;
  if (!token) return null;

  const response = await fetchWithTimeout("https://api.githubcopilot.com/models", {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Copilot-Integration-Id": "vscode-chat",
      "editor-version": "vscode/1.107.1",
      "editor-plugin-version": "copilot-chat/0.26.7",
      "user-agent": "GitHubCopilotChat/0.26.7",
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) return null;

  const data = await response.json();
  const rawModels = data?.data;
  if (!Array.isArray(rawModels)) return null;

  const map = new Map();
  for (const m of rawModels) {
    const id = m?.id;
    if (!id) continue;
    const limits = m?.capabilities?.limits;
    /** @type {object} */
    const caps = {};
    if (m?.capabilities?.type === "chat") {
      if (typeof limits?.max_context_window === "number") caps.contextWindow = limits.max_context_window;
      if (typeof limits?.max_output_tokens === "number") caps.maxOutput = limits.max_output_tokens;
    }
    if (Object.keys(caps).length > 0) map.set(id, caps);
  }
  return map.size > 0 ? map : null;
}

/**
 * Kiro: uses existing resolveKiroModels. Each model has contextLength.
 */
async function fetchKiroModels(connection) {
  const result = await resolveKiroModels(
    {
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      providerSpecificData: connection.providerSpecificData || {},
    },
    { log: console },
  );
  if (!result?.models?.length) return null;

  const map = new Map();
  for (const m of result.models) {
    const id = m?.id;
    if (!id) continue;
    /** @type {object} */
    const caps = {};
    if (typeof m.contextLength === "number") caps.contextWindow = m.contextLength;
    if (m.capabilities && typeof m.capabilities === "object") Object.assign(caps, m.capabilities);
    if (Object.keys(caps).length > 0) map.set(id, caps);
  }
  return map.size > 0 ? map : null;
}

/**
 * Qoder: uses existing resolveQoderModels. Each model has contextLength,
 * maxOutputTokens, isVL, isReasoning.
 */
async function fetchQoderModels(connection) {
  const result = await resolveQoderModels({
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    email: connection.email,
    displayName: connection.displayName,
    providerSpecificData: connection.providerSpecificData || {},
  });
  if (!result?.models?.length) return null;

  const map = new Map();
  for (const m of result.models) {
    const id = m?.id;
    if (!id) continue;
    /** @type {object} */
    const caps = {};
    if (typeof m.contextLength === "number") caps.contextWindow = m.contextLength;
    if (typeof m.maxOutputTokens === "number") caps.maxOutput = m.maxOutputTokens;
    if (m.isVL) caps.vision = true;
    if (m.isReasoning) caps.reasoning = true;
    if (Object.keys(caps).length > 0) map.set(id, caps);
  }
  return map.size > 0 ? map : null;
}

/**
 * Custom OpenAI-compatible provider: GET {baseUrl}/models, check for extended fields.
 * baseUrl from connection.providerSpecificData.baseUrl.
 */
async function fetchOpenAICompatibleModels(connection) {
  const baseUrl = getBaseUrl(connection);
  if (!baseUrl) return null;
  const apiKey = connection.apiKey;
  if (!apiKey) return null;

  const url = `${baseUrl}/models`;
  const response = await fetchWithTimeout(url, {
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
  });
  if (!response.ok) return null;

  const data = await response.json();
  const rawModels = parseOpenAIStyleModels(data);
  if (!rawModels.length) return null;

  return parseExtendedOpenAIStyleModels(rawModels);
}

/**
 * Custom Anthropic-compatible provider: GET {baseUrl}/models (strip /messages suffix).
 */
async function fetchAnthropicCompatibleModels(connection) {
  let baseUrl = getBaseUrl(connection);
  if (!baseUrl) return null;
  // Anthropic-style base URLs end with /messages or /v1/messages
  baseUrl = baseUrl.replace(/\/messages\/?$/, "");

  const apiKey = connection.apiKey;
  if (!apiKey) return null;

  const url = `${baseUrl}/models`;
  const response = await fetchWithTimeout(url, {
    headers: {
      "x-api-key": apiKey,
      "Authorization": `Bearer ${apiKey}`,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) return null;

  const data = await response.json();
  // Anthropic returns {data: [...]} — same shape as OpenAI
  const rawModels = data?.data || [];
  if (!rawModels.length) return null;

  return parseExtendedOpenAIStyleModels(rawModels);
}

/**
 * Generic OpenAI-style fetch for built-in providers. Returns null unless
 * the response contains extended metadata fields.
 */
async function fetchOpenAIStyleModels(connection) {
  const apiKey = connection.apiKey || connection.accessToken;
  if (!apiKey) return null;

  const providerId = connection.provider;
  const url = KNOWN_OPENAI_MODELS_URLS[providerId];
  if (!url) return null;

  const response = await fetchWithTimeout(url, {
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
  });
  if (!response.ok) return null;

  const data = await response.json();
  const rawModels = parseOpenAIStyleModels(data);
  if (!rawModels.length) return null;

  return parseExtendedOpenAIStyleModels(rawModels);
}

// ── URL helpers ────────────────────────────────────────────────────────

/** Known /models URLs for built-in OpenAI-style providers. */
const KNOWN_OPENAI_MODELS_URLS = {
  openai: "https://api.openai.com/v1/models",
  deepseek: "https://api.deepseek.com/models",
  groq: "https://api.groq.com/openai/v1/models",
  xai: "https://api.x.ai/v1/models",
  mistral: "https://api.mistral.ai/v1/models",
  perplexity: "https://api.perplexity.ai/v1/models",
  together: "https://api.together.xyz/v1/models",
  fireworks: "https://api.fireworks.ai/inference/v1/models",
  cerebras: "https://api.cerebras.ai/v1/models",
  cohere: "https://api.cohere.ai/v1/models",
  nebius: "https://api.studio.nebius.ai/v1/models",
  siliconflow: "https://api.siliconflow.com/v1/models",
  hyperbolic: "https://api.hyperbolic.xyz/v1/models",
  openrouter: "https://openrouter.ai/api/v1/models",
};

/**
 * Derive the base URL (without /chat/completions or /messages suffix) from a
 * connection's baseUrl. The connection object has providerSpecificData fields
 * flattened directly onto it (via rowToConn spread).
 */
function getBaseUrl(connection) {
  const raw = connection?.baseUrl || connection?.providerSpecificData?.baseUrl;
  if (typeof raw !== "string") return null;
  return raw.trim().replace(/\/$/, "").replace(/\/(chat\/completions|messages|responses)\/?$/, "");
}

// ── Parsers ────────────────────────────────────────────────────────────

function parseOpenAIStyleModels(data) {
  if (Array.isArray(data)) return data;
  return data?.data || data?.models || data?.results || [];
}

/**
 * Check model objects for extended metadata fields beyond the standard
 * OpenAI {id, object, created, owned_by} shape.
 *
 * Detected fields (any casing / snake_case variant):
 *   context_window, max_tokens, max_context_window, max_input_tokens,
 *   max_output_tokens, capabilities, limits, supported_modalities,
 *   input_modalities, output_modalities, token_limits, inputTokenLimit,
 *   outputTokenLimit, context_length, max_input_length
 *
 * Returns Map<modelId, partialCaps> if any model has extended fields,
 * or null if all models are bare-bones standard format.
 */
const EXTENDED_KEY_PATTERNS = [
  // keys that map to contextWindow
  { re: /^(context_?window|max_?context_?window|max_?input_?tokens?|input_?token_?limit|max_?input_?length|context_?length)$/i, field: "contextWindow" },
  // keys that map to maxOutput
  { re: /^(max_?tokens?|max_?output_?tokens?|output_?token_?limit|max_?output_?length)$/i, field: "maxOutput" },
];

const MODALITY_FIELDS = new Set([
  "supported_modalities", "input_modalities", "output_modalities",
]);

function parseExtendedOpenAIStyleModels(rawModels) {
  if (!Array.isArray(rawModels) || rawModels.length === 0) return null;

  // Quick scan: does any model have extended fields?
  let hasExtended = false;
  for (const m of rawModels) {
    if (!m || typeof m !== "object") continue;
    for (const key of Object.keys(m)) {
      if (EXTENDED_KEY_PATTERNS.some(p => p.re.test(key)) || MODALITY_FIELDS.has(key) || key === "supported_features" || key === "capabilities" || key === "limits") {
        hasExtended = true;
        break;
      }
    }
    if (hasExtended) break;
  }
  if (!hasExtended) return null;

  // Parse every model
  const map = new Map();
  for (const m of rawModels) {
    const id = m?.id || m?.name || m?.model;
    if (!id || typeof id !== "string") continue;

    /** @type {object} */
    const caps = {};

    // Extract contextWindow / maxOutput from known key patterns
    for (const key of Object.keys(m)) {
      for (const { re, field } of EXTENDED_KEY_PATTERNS) {
        if (re.test(key)) {
          const val = Number(m[key]);
          if (Number.isFinite(val) && val > 0) caps[field] = val;
          break;
        }
      }
    }

    // Extract capabilities sub-object (e.g. GitHub Copilot style)
    if (m.capabilities && typeof m.capabilities === "object") {
      if (typeof m.capabilities.vision === "boolean") caps.vision = m.capabilities.vision;
      if (typeof m.capabilities.reasoning === "boolean") caps.reasoning = m.capabilities.reasoning;
      if (typeof m.capabilities.search === "boolean") caps.search = m.capabilities.search;
      // nested limits
      const limits = m.capabilities.limits;
      if (limits && typeof limits === "object") {
        if (typeof limits.max_context_window === "number") caps.contextWindow = limits.max_context_window;
        if (typeof limits.max_output_tokens === "number") caps.maxOutput = limits.max_output_tokens;
      }
    }

    // Extract limits sub-object
    if (m.limits && typeof m.limits === "object") {
      if (typeof m.limits.context === "number") caps.contextWindow = m.limits.context;
      if (typeof m.limits.output === "number") caps.maxOutput = m.limits.output;
    }

    // Extract modalities
    for (const field of MODALITY_FIELDS) {
      const modalities = m[field];
      if (Array.isArray(modalities)) {
        const lower = modalities.map(s => String(s).toLowerCase());
        if (lower.some(s => s === "image" || s.includes("vision"))) caps.vision = true;
        if (lower.some(s => s === "audio")) caps.audioInput = true;
        if (lower.some(s => s === "video")) caps.videoInput = true;
      }
    }

    // Extract supported_features array (e.g. synthetic.new, LiteLLM gateways)
    if (Array.isArray(m.supported_features)) {
      const features = m.supported_features.map(s => String(s).toLowerCase());
      if (features.includes("reasoning") || features.includes("thinking")) caps.reasoning = true;
      if (features.includes("tools") || features.includes("function_calling")) caps.tools = true;
      if (features.includes("search") || features.includes("grounding") || features.includes("web_search")) caps.search = true;
      if (features.includes("vision") || features.includes("image")) caps.vision = true;
      if (features.includes("audio")) caps.audioInput = true;
      if (features.includes("video")) caps.videoInput = true;
      if (features.includes("structured_outputs") || features.includes("json_mode")) caps.structuredOutput = true;
    }

    if (Object.keys(caps).length > 0) map.set(id, caps);
  }

  return map.size > 0 ? map : null;
}

// ── Fetch helper ───────────────────────────────────────────────────────

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}
