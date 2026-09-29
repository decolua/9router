// Shared "is this key valid for this provider" logic — single home for the two
// call sites (POST /api/providers/validate and testSingleConnection) that used
// to reimplement this per-provider in separate switch statements that drifted
// (see docs/architecture-review.html candidate 1).
//
// probeConnection(provider, apiKey, opts) -> { valid, error }
// opts: { providerSpecificData, defaultModel, fetchImpl }
//   fetchImpl defaults to global fetch; callers pass a proxy-aware fetch when needed.
import { getDefaultModel } from "open-sse/config/providerModels.js";
import { resolveOllamaLocalHost, resolveXiaomiTokenplanBaseUrl, PROVIDERS } from "open-sse/config/providers.js";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { KIMCHI_CONFIG } from "@/lib/oauth/constants/oauth";

const AUTH_HEADER_BUILDERS = {
  bearer: (h, k) => { h["Authorization"] = `Bearer ${k}`; },
  "x-api-key": (h, k) => { h["x-api-key"] = k; },
  "x-subscription-token": (h, k) => { h["x-subscription-token"] = k; },
  key: (h, k) => { h["Authorization"] = `Key ${k}`; },
  "x-key": (h, k) => { h["x-key"] = k; },
  "xi-api-key": (h, k) => { h["xi-api-key"] = k; },
  token: (h, k) => { h["Authorization"] = `Token ${k}`; },
  basic: (h, k) => { h["Authorization"] = `Basic ${k}`; },
};

// Probe a webSearch/webFetch-only provider using its searchConfig/fetchConfig.
// Returns null (not applicable) when the provider isn't web-only.
async function probeWebProvider(provider, apiKey, fetchImpl) {
  const p = AI_PROVIDERS[provider];
  if (!p) return null;
  const kinds = p.serviceKinds || ["llm"];
  if (!kinds.every((k) => k === "webSearch" || k === "webFetch")) return null;
  const cfg = p.searchConfig || p.fetchConfig;
  if (!cfg) return null;
  if (cfg.authType === "none") return { valid: true, error: null };

  let url = cfg.baseUrl;
  const headers = { "Content-Type": "application/json" };
  let body;
  if (cfg.authHeader === "key") url += `?key=${encodeURIComponent(apiKey)}&q=ping&cx=test`;
  else if (cfg.authHeader === "api_key") url += `?api_key=${encodeURIComponent(apiKey)}&q=ping&engine=google`;
  else (AUTH_HEADER_BUILDERS[cfg.authHeader] || (() => {}))(headers, apiKey);
  if (cfg.method === "POST") body = JSON.stringify({ query: "ping", q: "ping", url: "https://example.com" });

  const res = await fetchImpl(url, { method: cfg.method, headers, body, signal: AbortSignal.timeout(8000) });
  const valid = res.status !== 401 && res.status !== 403;
  return { valid, error: valid ? null : "Invalid API key" };
}

// Probe a media (tts/embedding/stt/image/video/music) provider via *Config.
async function probeMediaProvider(provider, apiKey, fetchImpl) {
  const p = AI_PROVIDERS[provider];
  if (!p) return null;
  const MEDIA_KINDS = new Set(["tts", "embedding", "stt", "image", "video", "music", "imageToText"]);
  const kinds = p.serviceKinds || ["llm"];
  if (!kinds.every((k) => MEDIA_KINDS.has(k))) return null;
  const cfg = p.ttsConfig || p.sttConfig || p.embeddingConfig || p.imageConfig || p.videoConfig || p.musicConfig;
  if (!cfg) return { valid: true, error: null }; // no probe config → best-effort accept
  if (p.noAuth || cfg.authType === "none") return { valid: true, error: null };
  if (cfg.authHeader === "playht" || cfg.authHeader === "aws-sigv4") return { valid: true, error: null };
  const builder = AUTH_HEADER_BUILDERS[cfg.authHeader];
  if (!builder) return null; // unknown auth scheme → let caller's generic fallback try

  const headers = { "Content-Type": "application/json", ...(cfg.extraHeaders || {}) };
  builder(headers, apiKey);
  const method = cfg.method || "POST";
  const res = await fetchImpl(cfg.baseUrl, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify({ input: "ping", text: "ping", prompt: "ping", model: getDefaultModel(provider) || "test" }),
    signal: AbortSignal.timeout(8000),
  });
  const valid = res.status !== 401 && res.status !== 403;
  return { valid, error: valid ? null : "Invalid API key" };
}

// Probe a compatible-mode connection (OpenAI or Anthropic format, user-provided baseUrl).
// Exported so callers with a resolved baseUrl (from a "node" or from connection.providerSpecificData) share one impl.
export async function probeOpenAICompatBaseUrl(baseUrl, apiKey, fetchImpl, headers = {}) {
  const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/models`, { headers: { Authorization: `Bearer ${apiKey}`, ...headers } });
  return { valid: res.ok, error: res.ok ? null : "Invalid API key or base URL" };
}

export async function probeAnthropicCompatBaseUrl(baseUrl, apiKey, model, fetchImpl) {
  let base = baseUrl.trim().replace(/\/$/, "");
  if (base.endsWith("/messages")) base = base.slice(0, -9);
  const res = await fetchImpl(`${base}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model: model || "claude-3-haiku-20240307", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
  });
  // 400/529 still confirms key accepted; only 401/403 = bad key
  const valid = res.status !== 401 && res.status !== 403;
  return { valid, error: valid ? null : "Invalid API key or base URL" };
}

// Per-provider adapters for everything that isn't config-driven (custom formats,
// non-standard auth, cookie/session-based, or a fixed public endpoint+model).
const ADAPTERS = {
  "cloudflare-ai": async (apiKey, { providerSpecificData, fetchImpl }) => {
    const accountId = providerSpecificData?.accountId;
    if (!accountId) return { valid: false, error: "Missing Account ID" };
    const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: getDefaultModel("cloudflare-ai"), messages: [{ role: "user", content: "test" }], max_tokens: 1 }),
    });
    const valid = res.status !== 401 && res.status !== 403 && res.status !== 404;
    return { valid, error: valid ? null : "Invalid API token or Account ID" };
  },
  azure: async (apiKey, { providerSpecificData, fetchImpl }) => {
    const psd = providerSpecificData || {};
    const endpoint = (psd.azureEndpoint || "").replace(/\/$/, "");
    const deployment = psd.deployment || "gpt-4";
    const apiVersion = psd.apiVersion || "2024-10-01-preview";
    const headers = { "api-key": apiKey, "Content-Type": "application/json" };
    if (psd.organization) headers["OpenAI-Organization"] = psd.organization;
    const res = await fetchImpl(`${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`, {
      method: "POST", headers,
      body: JSON.stringify({ messages: [{ role: "user", content: "test" }], max_completion_tokens: 1 }),
    });
    const valid = res.status !== 401 && res.status !== 403;
    return { valid, error: valid ? null : "Invalid API key or Azure configuration" };
  },
  "ollama-local": async (_apiKey, { providerSpecificData, fetchImpl }) => {
    const host = resolveOllamaLocalHost({ providerSpecificData });
    const res = await fetchImpl(`${host}/api/tags`);
    return { valid: res.ok, error: res.ok ? null : `Ollama not reachable at ${host}` };
  },
  "xiaomi-tokenplan": async (apiKey, { providerSpecificData, fetchImpl }) => {
    const baseUrl = resolveXiaomiTokenplanBaseUrl({ providerSpecificData });
    const res = await fetchImpl(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    // /models returns 403 for valid keys lacking list permission; only 401 means invalid
    return { valid: res.status !== 401, error: res.status !== 401 ? null : "Invalid API key" };
  },
  xai: async (apiKey, { fetchImpl }) => {
    const res = await fetchImpl("https://api.x.ai/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } });
    // xai returns 400 for bad key, 403 for valid-but-no-credit
    const valid = res.status === 200 || res.status === 403;
    return { valid, error: valid ? null : "Invalid API key" };
  },
  "grok-web": async (apiKey, { fetchImpl }) => {
    const token = apiKey.startsWith("sso=") ? apiKey.slice(4) : apiKey;
    const randomHex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
    const statsigId = Buffer.from("e:TypeError: Cannot read properties of null (reading 'children')").toString("base64");
    const res = await fetchImpl("https://grok.com/rest/app-chat/conversations/new", {
      method: "POST",
      headers: {
        Accept: "*/*", "Content-Type": "application/json",
        Cookie: `sso=${token}`, Origin: "https://grok.com", Referer: "https://grok.com/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
        "x-statsig-id": statsigId, "x-xai-request-id": crypto.randomUUID(),
        traceparent: `00-${randomHex(16)}-${randomHex(8)}-00`,
      },
      body: JSON.stringify({ temporary: true, modelName: "grok-4", message: "ping", fileAttachments: [], imageAttachments: [], disableSearch: false, enableImageGeneration: false, sendFinalMetadata: true }),
    });
    const valid = res.status !== 401 && res.status !== 403;
    return { valid, error: valid ? null : "Invalid SSO cookie" };
  },
  "perplexity-web": async (apiKey, { fetchImpl }) => {
    let sessionToken = apiKey;
    if (sessionToken.startsWith("__Secure-next-auth.session-token=")) sessionToken = sessionToken.slice("__Secure-next-auth.session-token=".length);
    const res = await fetchImpl("https://www.perplexity.ai/api/auth/session", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
        Cookie: `__Secure-next-auth.session-token=${sessionToken}`,
      },
    });
    if (!res.ok) return { valid: false, error: "Invalid session cookie" };
    const data = await res.json().catch(() => null);
    const valid = !!(data && data.user);
    return { valid, error: valid ? null : "Session expired — re-paste cookie" };
  },
  qoder: async (apiKey, { fetchImpl }) => {
    const pat = apiKey.startsWith("pt-") ? apiKey : `pt-${apiKey}`;
    const res = await fetchImpl("https://openapi.qoder.sh/api/v1/jobToken/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "Cosy-Version": "1.0.1", "Cosy-ClientType": "5" },
      body: JSON.stringify({ personal_token: pat }),
    });
    return { valid: res.ok, error: res.ok ? null : "Invalid Personal Access Token" };
  },
  kimchi: async (apiKey, { fetchImpl }) => {
    const url = KIMCHI_CONFIG.validationUrl || "https://api.cast.ai/v1/llm/openai/supported-providers";
    const res = await fetchImpl(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}`, "User-Agent": "kimchi/0.1.40" },
    });
    return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
  },
  commandcode: async (apiKey, { fetchImpl }) => {
    const { openaiToCommandCodeRequest } = await import("open-sse/translator/request/openai-to-commandcode.js");
    const cfg = PROVIDERS.commandcode;
    const payload = openaiToCommandCodeRequest(getDefaultModel("commandcode"), { messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false }, false);
    const res = await fetchImpl(cfg.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cfg.headers || {}), "x-session-id": crypto.randomUUID(), Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    });
    const valid = res.status !== 401 && res.status !== 403;
    return { valid, error: valid ? null : "Invalid API key" };
  },
  vertex: async (apiKey, { fetchImpl }) => probeVertex(apiKey, fetchImpl),
  "vertex-partner": async (apiKey, { fetchImpl }) => probeVertex(apiKey, fetchImpl),
  "fal-ai": async (apiKey, { fetchImpl }) => {
    const res = await fetchImpl("https://api.fal.ai/v1/models?limit=1", { headers: { Authorization: `Key ${apiKey}` } });
    const valid = res.status !== 401 && res.status !== 403;
    return { valid, error: valid ? null : "Invalid API key" };
  },
};
ADAPTERS["opencode"] = async (_apiKey, { fetchImpl }) => {
  const res = await fetchImpl("https://opencode.ai/zen/v1/models", {
    headers: { Authorization: "Bearer public", "User-Agent": "opencode/1.18.31" },
  });
  return { valid: res.ok, error: res.ok ? null : "OpenCode free tier unavailable" };
};
ADAPTERS["opencode-go"] = async (apiKey, { fetchImpl }) => {
  const res = await fetchImpl("https://opencode.ai/zen/go/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: getDefaultModel("opencode-go"), messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false }),
  });
  const valid = res.status !== 401 && res.status !== 403;
  return { valid, error: valid ? null : "Invalid API key" };
};

async function probeVertex(apiKey, fetchImpl) {
  const saJson = (() => { try { const p = JSON.parse(apiKey); return p.type === "service_account" ? p : null; } catch { return null; } })();
  if (saJson) {
    const valid = !!(saJson.client_email && saJson.private_key && saJson.project_id);
    return { valid, error: valid ? null : "Invalid service account JSON" };
  }
  const res = await fetchImpl(
    `https://aiplatform.googleapis.com/v1/publishers/google/models/__probe__:generateContent?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
  );
  const valid = res.status !== 401 && res.status !== 403;
  return { valid, error: valid ? null : "Invalid API key" };
}

// Providers whose transport uses claude/anthropic format at their baseUrl (probed with a 1-token message).
const ANTHROPIC_FORMAT_PROVIDERS = new Set(["glm", "minimax", "minimax-cn", "kimi"]);
const ANTHROPIC_BASE_URLS = {
  glm: "https://api.z.ai/api/anthropic/v1/messages",
  minimax: "https://api.minimax.io/anthropic/v1/messages",
  "minimax-cn": "https://api.minimaxi.com/anthropic/v1/messages",
  kimi: "https://api.kimi.com/coding/v1/messages",
};

const ALICODE_BASE_URLS = {
  "alicode-intl": "https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions",
  "alims-intl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
  alicode: "https://coding.dashscope.aliyuncs.com/v1/chat/completions",
};

/**
 * Probe whether `apiKey` is accepted by `provider`.
 * @param {string} provider - normalized provider id
 * @param {string} apiKey
 * @param {{providerSpecificData?: object, fetchImpl?: Function}} opts
 * @returns {Promise<{valid: boolean, error: string|null}>}
 */
export async function probeConnection(provider, apiKey, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const providerSpecificData = opts.providerSpecificData;

  if (ADAPTERS[provider]) return ADAPTERS[provider](apiKey, { providerSpecificData, fetchImpl });

  if (ANTHROPIC_FORMAT_PROVIDERS.has(provider)) {
    return probeAnthropicCompatBaseUrl(ANTHROPIC_BASE_URLS[provider], apiKey, getDefaultModel(provider), fetchImpl);
  }
  if (ALICODE_BASE_URLS[provider]) {
    const res = await fetchImpl(ALICODE_BASE_URLS[provider], {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: getDefaultModel(provider), max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
    });
    const valid = res.status !== 401 && res.status !== 403;
    return { valid, error: valid ? null : "Invalid API key" };
  }
  if (provider === "agentrouter" || provider === "glm-cn") {
    const cfg = PROVIDERS[provider];
    const res = await fetchImpl(cfg.baseUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json", ...(cfg.headers || {}) },
      body: JSON.stringify({ model: getDefaultModel(provider), max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
    });
    const valid = res.status !== 401 && res.status !== 403;
    return { valid, error: valid ? null : "Invalid API key" };
  }
  if (provider === "volcengine-ark" || provider === "byteplus") {
    const res = await fetchImpl(PROVIDERS[provider]?.baseUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: getDefaultModel(provider), max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
    });
    const valid = res.status !== 401 && res.status !== 403;
    return { valid, error: valid ? null : "Invalid API key" };
  }

  // Config-driven web/media probes (custom providers registered with searchConfig/ttsConfig/etc).
  const webResult = await probeWebProvider(provider, apiKey, fetchImpl);
  if (webResult !== null) return webResult;
  const mediaResult = await probeMediaProvider(provider, apiKey, fetchImpl);
  if (mediaResult !== null) return mediaResult;

  // Generic fallback: any provider registered with a validateUrl (plain GET, bearer auth) or,
  // failing that, a chat-completions baseUrl (OpenAI format, POST probe).
  const cfg = PROVIDERS[provider];
  if (cfg?.noAuth) return { valid: true, error: null };
  if (cfg?.validateUrl) {
    const res = await fetchImpl(cfg.validateUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
  }
  if (cfg?.baseUrl && cfg.format === "openai") {
    const headers = { "Content-Type": "application/json", ...(cfg.headers || {}) };
    if (cfg.authHeader === "x-api-key") headers["X-API-Key"] = apiKey;
    else headers["Authorization"] = `Bearer ${apiKey}`;
    const modelsUrl = cfg.baseUrl.replace(/\/chat\/completions$/, "/models").replace(/\/chatbot$/, "/models");
    try {
      const probeRes = await fetchImpl(modelsUrl, { headers, signal: AbortSignal.timeout(8000) });
      if (probeRes.status === 401 || probeRes.status === 403) return { valid: false, error: "Invalid API key" };
      if (probeRes.ok) return { valid: true, error: null };
    } catch { /* fall through to chat probe */ }
    const chatRes = await fetchImpl(cfg.baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: getDefaultModel(provider) || "test", messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
      signal: AbortSignal.timeout(10000),
    });
    const valid = chatRes.status !== 401 && chatRes.status !== 403;
    return { valid, error: valid ? null : "Invalid API key" };
  }

  return { valid: false, error: "Provider test not supported" };
}
