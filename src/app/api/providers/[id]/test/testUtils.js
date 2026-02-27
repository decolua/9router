import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { getDefaultModel } from "open-sse/config/providerModels.js";
import {
  GEMINI_CONFIG,
  ANTIGRAVITY_CONFIG,
  CODEX_CONFIG,
  KIRO_CONFIG,
  QWEN_CONFIG,
  CLAUDE_CONFIG,
} from "@/lib/oauth/constants/oauth";

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
  cursor: { tokenExists: true },
};

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

async function testOAuthConnection(connection) {
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

  try {
    const testUrl = config.buildUrl ? config.buildUrl(accessToken) : config.url;
    const headers = config.noAuth
      ? { ...config.extraHeaders }
      : { [config.authHeader]: `${config.authPrefix}${accessToken}`, ...config.extraHeaders };
    const res = await fetch(testUrl, { method: config.method, headers });

    if (res.ok) return { valid: true, error: null, refreshed, newTokens };

    if (res.status === 401 && config.refreshable && !refreshed && connection.refreshToken) {
      const tokens = await refreshOAuthToken(connection);
      if (tokens) {
        const retryUrl = config.buildUrl ? config.buildUrl(tokens.accessToken) : testUrl;
        const retryHeaders = config.noAuth
          ? { ...config.extraHeaders }
          : { [config.authHeader]: `${config.authPrefix}${tokens.accessToken}`, ...config.extraHeaders };
        const retryRes = await fetch(retryUrl, {
          method: config.method,
          headers: retryHeaders,
        });
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

async function testApiKeyConnection(connection) {
  if (isOpenAICompatibleProvider(connection.provider)) {
    const modelsBase = connection.providerSpecificData?.baseUrl;
    if (!modelsBase) return { valid: false, error: "Missing base URL" };
    try {
      const res = await fetch(`${modelsBase.replace(/\/$/, "")}/models`, {
        headers: { "Authorization": `Bearer ${connection.apiKey}` },
      });
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
      const res = await fetch(`${modelsBase}/models`, {
        headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "Authorization": `Bearer ${connection.apiKey}` },
      });
      return { valid: res.ok, error: res.ok ? null : "Invalid API key or base URL" };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  try {
    switch (connection.provider) {
      case "openai": {
        const res = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "anthropic": {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "claude-3-haiku-20240307", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        });
        const valid = res.status !== 401;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "gemini": {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${connection.apiKey}`);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "openrouter": {
        const res = await fetch("https://openrouter.ai/api/v1/auth/key", { headers: { Authorization: `Bearer ${connection.apiKey}` } });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "glm": {
        const res = await fetch("https://api.z.ai/api/anthropic/v1/messages", {
          method: "POST",
          headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "glm-4.7", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        });
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "glm-cn": {
        const res = await fetch("https://open.bigmodel.cn/api/coding/paas/v4/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${connection.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model: "glm-4.7", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        });
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "minimax":
      case "minimax-cn": {
        const endpoints = { minimax: "https://api.minimax.io/anthropic/v1/messages", "minimax-cn": "https://api.minimaxi.com/anthropic/v1/messages" };
        const res = await fetch(endpoints[connection.provider], {
          method: "POST",
          headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "minimax-m2", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        });
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "kimi": {
        const res = await fetch("https://api.kimi.com/coding/v1/messages", {
          method: "POST",
          headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "kimi-latest", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        });
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "alicode": {
        // Aliyun Coding Plan uses OpenAI-compatible API
        const res = await fetch("https://coding.dashscope.aliyuncs.com/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${connection.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model: getDefaultModel("alicode"), max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
        });
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }
      case "deepseek": {
        const res = await fetch("https://api.deepseek.com/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "groq": {
        const res = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "mistral": {
        const res = await fetch("https://api.mistral.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "xai": {
        const res = await fetch("https://api.x.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "nvidia": {
        const res = await fetch("https://integrate.api.nvidia.com/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "perplexity": {
        const res = await fetch("https://api.perplexity.ai/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "together": {
        const res = await fetch("https://api.together.xyz/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "fireworks": {
        const res = await fetch("https://api.fireworks.ai/inference/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "cerebras": {
        const res = await fetch("https://api.cerebras.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "cohere": {
        const res = await fetch("https://api.cohere.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "nebius": {
        const res = await fetch("https://api.studio.nebius.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "siliconflow": {
        const res = await fetch("https://api.siliconflow.cn/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "hyperbolic": {
        const res = await fetch("https://api.hyperbolic.xyz/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "deepgram": {
        const res = await fetch("https://api.deepgram.com/v1/projects", { headers: { Authorization: `Token ${connection.apiKey}` } });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "assemblyai": {
        const res = await fetch("https://api.assemblyai.com/v1/account", { headers: { Authorization: `Bearer ${connection.apiKey}` } });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "nanobanana": {
        const res = await fetch("https://api.nanobananaapi.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }
      case "chutes": {
        const res = await fetch("https://llm.chutes.ai/v1/models", { headers: { Authorization: `Bearer ${connection.apiKey}` } });
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

  const start = Date.now();
  let result;

  if (connection.authType === "apikey") {
    result = await testApiKeyConnection(connection);
  } else {
    result = await testOAuthConnection(connection);
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
