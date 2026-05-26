import { FREE_PROVIDERS, AI_PROVIDERS } from "@/shared/constants/providers.js";

// Known provider probe endpoints (apiKey providers only).
// ADD NEW LLM PROVIDERS HERE — both startup probe and validate/route.js pick them up automatically.
export const PROBE_ENDPOINTS = {
  openai: { url: "https://api.openai.com/v1/models", authHeader: "bearer" },
  anthropic: { url: "https://api.anthropic.com/v1/models", authHeader: "x-api-key" },
  gemini: { url: "https://generativelanguage.googleapis.com/v1/models", authHeader: "key-param" },
  openrouter: { url: "https://openrouter.ai/api/v1/models", authHeader: "bearer" },
  groq: { url: "https://api.groq.com/openai/v1/models", authHeader: "bearer" },
  deepseek: { url: "https://api.deepseek.com/models", authHeader: "bearer" },
  mistral: { url: "https://api.mistral.ai/v1/models", authHeader: "bearer" },
  xai: { url: "https://api.x.ai/v1/models", authHeader: "bearer", validStatus: [200, 403] },
  cohere: { url: "https://api.cohere.ai/v1/models", authHeader: "bearer" },
  together: { url: "https://api.together.xyz/v1/models", authHeader: "bearer" },
  fireworks: { url: "https://api.fireworks.ai/inference/v1/models", authHeader: "bearer" },
  cerebras: { url: "https://api.cerebras.ai/v1/models", authHeader: "bearer" },
  perplexity: { url: "https://api.perplexity.ai/models", authHeader: "bearer" },
  siliconflow: { url: "https://api.siliconflow.cn/v1/models", authHeader: "bearer" },
  hyperbolic: { url: "https://api.hyperbolic.xyz/v1/models", authHeader: "bearer" },
  nvidia: { url: "https://integrate.api.nvidia.com/v1/models", authHeader: "bearer" },
  chutes: { url: "https://llm.chutes.ai/v1/models", authHeader: "bearer" },
  "vercel-ai-gateway": { url: "https://ai-gateway.vercel.sh/v1/models", authHeader: "bearer" },
  assemblyai: { url: "https://api.assemblyai.com/v1/account", authHeader: "bearer" },
  nebius: { url: "https://api.studio.nebius.ai/v1/models", authHeader: "bearer" },
  nanobanana: { url: "https://api.nanobananaapi.ai/v1/models", authHeader: "bearer" },
  "xiaomi-mimo": { url: "https://api.xiaomimimo.com/v1/models", authHeader: "bearer" },
};

// Token expiry buffer: treat tokens expiring within 5 min as invalid
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * Probe a single DB connection to verify its credentials are valid.
 *
 * @param {object} connection - Row from providerConnections (with decrypted credentials)
 * @param {number} timeoutMs - Probe timeout (default 5s)
 * @returns {Promise<{valid: boolean, skipped: boolean, reason?: string, statusCode?: number, error?: string}>}
 */
export async function probeProviderConnection(connection, timeoutMs = 5000) {
  const { provider, authType } = connection;

  // Skip no-auth / free providers
  if (FREE_PROVIDERS?.[provider]?.noAuth || AI_PROVIDERS?.[provider]?.noAuth) {
    return { valid: true, skipped: true, reason: "no-auth provider" };
  }

  // For OAuth connections, check token expiry without a network call
  if (authType === "oauth" || authType === "access_token") {
    const token = connection.accessToken;
    if (!token) {
      return { valid: false, skipped: false, reason: "no access token", error: "missing access token" };
    }
    if (connection.expiresAt) {
      const expiresAt = new Date(connection.expiresAt).getTime();
      if (!isNaN(expiresAt) && expiresAt - Date.now() < EXPIRY_BUFFER_MS) {
        return { valid: false, skipped: false, reason: "token expired or expiring soon", error: "token expired" };
      }
    }
    // Token present and not expired — treat as valid without a network probe
    return { valid: true, skipped: true, reason: "oauth token present and not expired" };
  }

  // Cookie-based providers: skip network probe (cookies are opaque)
  if (authType === "cookie") {
    const cookie = connection.apiKey;
    if (!cookie) return { valid: false, skipped: false, error: "missing cookie credential" };
    return { valid: true, skipped: true, reason: "cookie-based auth (not probed)" };
  }

  // API key providers: network probe
  const apiKey = connection.apiKey;
  if (!apiKey) {
    return { valid: false, skipped: false, error: "no API key configured" };
  }

  const probe = PROBE_ENDPOINTS[provider];
  if (!probe) {
    // Unknown provider — skip rather than fail
    return { valid: true, skipped: true, reason: "no probe defined for provider" };
  }

  try {
    const headers = buildHeaders(probe.authHeader, apiKey);
    const url =
      probe.authHeader === "key-param"
        ? `${probe.url}?key=${encodeURIComponent(apiKey)}`
        : probe.url;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    const validStatuses = probe.validStatus ?? null;
    const valid = validStatuses
      ? validStatuses.includes(res.status)
      : res.ok;

    return {
      valid,
      skipped: false,
      statusCode: res.status,
      error: valid ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      return { valid: false, skipped: false, error: "timeout" };
    }
    return { valid: false, skipped: false, error: err.message };
  }
}

export function buildHeaders(authHeader, apiKey) {
  switch (authHeader) {
    case "bearer":
      return { Authorization: `Bearer ${apiKey}` };
    case "x-api-key":
      return { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
    case "key-param":
      return {}; // key goes in URL param
    default:
      return { Authorization: `Bearer ${apiKey}` };
  }
}
