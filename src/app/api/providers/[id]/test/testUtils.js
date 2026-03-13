import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { testProxyUrl } from "@/lib/network/proxyTest";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { getDefaultModel } from "open-sse/config/providerModels.js";
import {
  GEMINI_CONFIG,
  ANTIGRAVITY_CONFIG,
  CODEX_CONFIG,
  KIRO_CONFIG,
  QWEN_CONFIG,
  CLAUDE_CONFIG,
  CLINE_CONFIG,
  KILOCODE_CONFIG,
} from "@/lib/oauth/constants/oauth";
import { buildClineHeaders } from "@/shared/utils/clineAuth";

// OAuth provider test endpoints
const OAUTH_TEST_CONFIG = {
  claude: { checkExpiry: true, refreshable: true },
  codex: { checkExpiry: true, refreshable: true },
  "gemini-cli": {
    url: "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: true,
  },
  antigravity: {
    url: "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: true,
  },
  github: {
    url: "https://api.github.com/user",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: { "User-Agent": "9Router", "Accept": "application/vnd.github+json" },
  },
  iflow: {
    // iFlow getUserInfo requires accessToken as query param, not header
    buildUrl: (token) => `https://iflow.cn/api/oauth/getUserInfo?accessToken=${encodeURIComponent(token)}`,
    method: "GET",
    noAuth: true,
  },
  qwen: { checkExpiry: true, refreshable: true },
  kiro: { checkExpiry: true, refreshable: true },
  "kimi-coding": { checkExpiry: true, refreshable: false },
  cursor: { tokenExists: true },
  kilocode: {
    url: `${KILOCODE_CONFIG.apiBaseUrl}/api/profile`,
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
  },
  cline: { refreshable: true },
};

async function probeClineAccessToken(accessToken) {
  const res = await fetch("https://api.cline.bot/api/v1/users/me", {
    method: "GET",
    headers: buildClineHeaders(accessToken, {
      Accept: "application/json",
    }),
  });

  return res;
}

async function refreshOAuthToken(connection) {
  const provider = connection.provider;
  const refreshToken = connection.refreshToken;
  if (!refreshToken) return null;

  try {
    if (provider === "gemini-cli" || provider === "antigravity") {
      const config = provider === "gemini-cli" ? GEMINI_CONFIG : ANTIGRAVITY_CONFIG;
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return { accessToken: data.access_token, expiresIn: data.expires_in, refreshToken: data.refresh_token || refreshToken };
    }

    if (provider === "codex") {
      const response = await fetch(CODEX_CONFIG.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: CODEX_CONFIG.clientId,
          refresh_token: refreshToken,
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return { accessToken: data.access_token, expiresIn: data.expires_in, refreshToken: data.refresh_token || refreshToken };
    }

    if (provider === "claude") {
      const response = await fetch(CLAUDE_CONFIG.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: CLAUDE_CONFIG.clientId,
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return { accessToken: data.access_token, expiresIn: data.expires_in, refreshToken: data.refresh_token || refreshToken };
    }

    if (provider === "kiro") {
      const psd = connection.providerSpecificData || {};
      const clientId = psd.clientId || connection.clientId;
      const clientSecret = psd.clientSecret || connection.clientSecret;
      const region = psd.region || connection.region;
      if (clientId && clientSecret) {
        const endpoint = `https://oidc.${region || "us-east-1"}.amazonaws.com/token`;
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, clientSecret, refreshToken, grantType: "refresh_token" }),
        });
        if (!response.ok) return null;
        const data = await response.json();
        return { accessToken: data.accessToken, expiresIn: data.expiresIn || 3600, refreshToken: data.refreshToken || refreshToken };
      }
      const response = await fetch(KIRO_CONFIG.socialRefreshUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "kiro-cli/1.0.0" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return { accessToken: data.accessToken, expiresIn: data.expiresIn || 3600, refreshToken: data.refreshToken || refreshToken };
    }

    if (provider === "qwen") {
      const response = await fetch(QWEN_CONFIG.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: QWEN_CONFIG.clientId,
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return { accessToken: data.access_token, expiresIn: data.expires_in, refreshToken: data.refresh_token || refreshToken };
    }

    if (provider === "cline") {
      const response = await fetch(CLINE_CONFIG.refreshUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          refreshToken,
          grantType: "refresh_token",
          clientType: "extension",
        }),
      });
      if (!response.ok) return null;
      const payload = await response.json();
      const data = payload?.data || payload;
      const expiresIn = data?.expiresAt
        ? Math.max(1, Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000))
        : 3600;
      return {
        accessToken: data?.accessToken,
        expiresIn,
        refreshToken: data?.refreshToken || refreshToken,
      };
    }

    return null;
  } catch (err) {
    console.log(`Error refreshing ${provider} token:`, err.message);
    return null;
  }
}

function isTokenExpired(connection) {
  if (!connection.expiresAt) return false;
  const expiresAt = new Date(connection.expiresAt).getTime();
  const buffer = 5 * 60 * 1000;
  return expiresAt <= Date.now() + buffer;
}

async function testOAuthConnection(connection, effectiveProxy = null) {
  const config = OAUTH_TEST_CONFIG[connection.provider];
  if (!config) return { valid: false, error: "Provider test not supported", refreshed: false };
  if (!connection.accessToken) return { valid: false, error: "No access token", refreshed: false };

  // Cursor uses protobuf API - can only verify token exists, not test endpoint
  if (config.tokenExists) {
    return { valid: true, error: null, refreshed: false, newTokens: null };
  }

  let accessToken = connection.accessToken;
  let refreshed = false;
  let newTokens = null;

  const tokenExpired = isTokenExpired(connection);
  if (config.refreshable && tokenExpired && connection.refreshToken) {
    const tokens = await refreshOAuthToken(connection);
    if (tokens) {
      accessToken = tokens.accessToken;
      refreshed = true;
      newTokens = tokens;
    } else {
      return { valid: false, error: "Token expired and refresh failed", refreshed: false };
    }
  }

  if (config.checkExpiry) {
    if (refreshed) return { valid: true, error: null, refreshed, newTokens };
    if (tokenExpired) return { valid: false, error: "Token expired", refreshed: false };
    return { valid: true, error: null, refreshed: false, newTokens: null };
  }

  if (connection.provider === "cline") {
    const tryProbe = async (token) => {
      const res = await probeClineAccessToken(token);
      if (res.ok) return { valid: true, error: null, refreshed, newTokens };
      if (res.status === 401) return { valid: false, error: "Token invalid or revoked", refreshed };
      if (res.status === 403) return { valid: false, error: "Access denied", refreshed };
      return { valid: false, error: `API returned ${res.status}`, refreshed };
    };

    const initial = await tryProbe(accessToken);
    if (initial.valid || initial.error !== "Token invalid or revoked" || !connection.refreshToken) {
      return initial;
    }

    const tokens = await refreshOAuthToken(connection);
    if (!tokens?.accessToken) {
      return { valid: false, error: "Token invalid or revoked", refreshed: false };
    }

    refreshed = true;
    newTokens = tokens;
    accessToken = tokens.accessToken;
    return await tryProbe(accessToken);
  }

  try {
    const testUrl = config.buildUrl ? config.buildUrl(accessToken) : config.url;
    const headers = config.noAuth
      ? { ...config.extraHeaders }
      : { [config.authHeader]: `${config.authPrefix}${accessToken}`, ...config.extraHeaders };
    const res = await fetchWithConnectionProxy(testUrl, { method: config.method, headers }, effectiveProxy);

    if (res.ok) return { valid: true, error: null, refreshed, newTokens };

    if (res.status === 401 && config.refreshable && !refreshed && connection.refreshToken) {
      const tokens = await refreshOAuthToken(connection);
      if (tokens) {
        const retryUrl = config.buildUrl ? config.buildUrl(tokens.accessToken) : testUrl;
        const retryHeaders = config.noAuth
          ? { ...config.extraHeaders }
          : { [config.authHeader]: `${config.authPrefix}${tokens.accessToken}`, ...config.extraHeaders };
        const retryRes = await fetchWithConnectionProxy(retryUrl, {
          method: config.method,
          headers: retryHeaders,
        }, effectiveProxy);
        if (retryRes.ok) return { valid: true, error: null, refreshed: true, newTokens: tokens };
      }
      return { valid: false, error: "Token invalid or revoked", refreshed: false };
    }

    if (res.status === 401) return { valid: false, error: "Token invalid or revoked", refreshed };
    if (res.status === 403) return { valid: false, error: "Access denied", refreshed };
    return { valid: false, error: `API returned ${res.status}`, refreshed };
  } catch (err) {
    return { valid: false, error: err.message, refreshed };
  }
}

async function fetchWithConnectionProxy(url, options = {}, effectiveProxy = null) {
  if (!effectiveProxy?.connectionProxyEnabled || !effectiveProxy?.connectionProxyUrl) {
    return fetch(url, options);
  }

  const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");
  return proxyAwareFetch(url, options, {
    connectionProxyEnabled: true,
    connectionProxyUrl: effectiveProxy.connectionProxyUrl,
    connectionNoProxy: effectiveProxy.connectionNoProxy || "",
  });
}

async function testApiKeyConnection(connection, effectiveProxy = null) {
  if (isOpenAICompatibleProvider(connection.provider)) {
    const modelsBase = connection.providerSpecificData?.baseUrl;
    if (!modelsBase) return { valid: false, error: "Missing base URL" };
    try {
      const res = await fetchWithConnectionProxy(`${modelsBase.replace(/\/$/, "")}/models`, {
        headers: { "Authorization": `Bearer ${connection.apiKey}` },
      }, effectiveProxy);
      return { valid: res.ok, error: res.ok ? null : "Invalid API key or base URL" };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  if (isAnthropicCompatibleProvider(connection.provider)) {
    let modelsBase = connection.providerSpecificData?.baseUrl;
    if (!modelsBase) return { valid: false, error: "Missing base URL" };
    try {
      modelsBase = modelsBase.replace(/\/$/, "");
      if (modelsBase.endsWith("/messages")) modelsBase = modelsBase.slice(0, -9);
      const res = await fetchWithConnectionProxy(`${modelsBase}/models`, {
        headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "Authorization": `Bearer ${connection.apiKey}` },
      }, effectiveProxy);
      return { valid: res.ok, error: res.ok ? null : "Invalid API key or base URL" };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  try {
    switch (connection.provider) {
      case "openai": {
        const res = await fetchWithConnectionProxy("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "anthropic": {
        const res = await fetchWithConnectionProxy("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "claude-3-haiku-20240307", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        }, effectiveProxy);
        const valid = res.status !== 401;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "gemini": {
        const res = await fetchWithConnectionProxy(`https://generativelanguage.googleapis.com/v1/models?key=${connection.apiKey}`, {}, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "openrouter": {
        const res = await fetchWithConnectionProxy("https://openrouter.ai/api/v1/auth/key", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "glm": {
        const res = await fetchWithConnectionProxy("https://api.z.ai/api/anthropic/v1/messages", {
          method: "POST",
          headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "glm-4.7", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "glm-cn": {
        const res = await fetchWithConnectionProxy("https://open.bigmodel.cn/api/coding/paas/v4/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${connection.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model: "glm-4.7", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "minimax":
      case "minimax-cn": {
        const endpoints = { minimax: "https://api.minimax.io/anthropic/v1/messages", "minimax-cn": "https://api.minimaxi.com/anthropic/v1/messages" };
        const res = await fetchWithConnectionProxy(endpoints[connection.provider], {
          method: "POST",
          headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "minimax-m2", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "kimi": {
        const res = await fetchWithConnectionProxy("https://api.kimi.com/coding/v1/messages", {
          method: "POST",
          headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "kimi-latest", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "alicode":
      case "alicode-intl": {
        // Aliyun Coding Plan uses OpenAI-compatible API
        const aliBaseUrl = connection.provider === "alicode-intl"
          ? "https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions"
          : "https://coding.dashscope.aliyuncs.com/v1/chat/completions";
        const res = await fetchWithConnectionProxy(aliBaseUrl, {
          method: "POST",
          headers: { "Authorization": `Bearer ${connection.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model: getDefaultModel(connection.provider), max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        }, effectiveProxy);
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "deepseek": {
        const res = await fetchWithConnectionProxy("https://api.deepseek.com/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "groq": {
        const res = await fetchWithConnectionProxy("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "mistral": {
        const res = await fetchWithConnectionProxy("https://api.mistral.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "xai": {
        const res = await fetchWithConnectionProxy("https://api.x.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "nvidia": {
        const res = await fetchWithConnectionProxy("https://integrate.api.nvidia.com/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "perplexity": {
        const res = await fetchWithConnectionProxy("https://api.perplexity.ai/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "together": {
        const res = await fetchWithConnectionProxy("https://api.together.xyz/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "fireworks": {
        const res = await fetchWithConnectionProxy("https://api.fireworks.ai/inference/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "cerebras": {
        const res = await fetchWithConnectionProxy("https://api.cerebras.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "cohere": {
        const res = await fetchWithConnectionProxy("https://api.cohere.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "nebius": {
        const res = await fetchWithConnectionProxy("https://api.studio.nebius.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "siliconflow": {
        const res = await fetchWithConnectionProxy("https://api.siliconflow.cn/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "hyperbolic": {
        const res = await fetchWithConnectionProxy("https://api.hyperbolic.xyz/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "ollama": {
        const res = await fetch("https://ollama.com/api/tags", { headers: { Authorization: `Bearer ${connection.apiKey}` } });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "ollama-local": {
        // No auth required for local Ollama
        const res = await fetch("http://localhost:11434/api/tags");
        return { valid: res.ok, error: res.ok ? null : "Ollama not running on localhost:11434" };
      }
      case "deepgram": {
        const res = await fetchWithConnectionProxy("https://api.deepgram.com/v1/projects", { headers: { Authorization: `Token ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "assemblyai": {
        const res = await fetchWithConnectionProxy("https://api.assemblyai.com/v1/account", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "nanobanana": {
        const res = await fetchWithConnectionProxy("https://api.nanobananaapi.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "chutes": {
        const res = await fetchWithConnectionProxy("https://llm.chutes.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, effectiveProxy);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      default:
        return { valid: false, error: "Provider test not supported" };
    }
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Test a single connection by ID, update DB, and return result.
 */
export async function testSingleConnection(id) {
  const connection = await getProviderConnectionById(id);
  if (!connection) return { valid: false, error: "Connection not found", latencyMs: 0, testedAt: new Date().toISOString() };

  const effectiveProxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});

  if (effectiveProxy.connectionProxyEnabled && effectiveProxy.connectionProxyUrl) {
    const proxyResult = await testProxyUrl({ proxyUrl: effectiveProxy.connectionProxyUrl });
    if (!proxyResult.ok) {
      const proxyError = proxyResult.error || `Proxy test failed with status ${proxyResult.status}`;
      await updateProviderConnection(id, {
        testStatus: "error",
        lastError: proxyError,
        lastErrorAt: new Date().toISOString(),
      });
      return { valid: false, error: proxyError, latencyMs: 0, testedAt: new Date().toISOString() };
    }
  }

  const start = Date.now();
  let result;

  if (connection.authType === "apikey") {
    result = await testApiKeyConnection(connection, effectiveProxy);
  } else {
    result = await testOAuthConnection(connection, effectiveProxy);
  }

  const latencyMs = Date.now() - start;

  const updateData = {
    testStatus: result.valid ? "active" : "error",
    lastError: result.valid ? null : result.error,
    lastErrorAt: result.valid ? null : new Date().toISOString(),
  };

  if (result.refreshed && result.newTokens) {
    updateData.accessToken = result.newTokens.accessToken;
    if (result.newTokens.refreshToken) updateData.refreshToken = result.newTokens.refreshToken;
    if (result.newTokens.expiresIn) {
      updateData.expiresAt = new Date(Date.now() + result.newTokens.expiresIn * 1000).toISOString();
    }
  }

  await updateProviderConnection(id, updateData);

  return { valid: result.valid, error: result.error, latencyMs, testedAt: new Date().toISOString() };
}
