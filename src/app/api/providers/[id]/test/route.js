import { NextResponse } from "next/server";
import { getProviderConnectionById, updateProviderConnection, isCloudEnabled } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/app/api/sync/cloud/route";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import {
  GEMINI_CONFIG,
  ANTIGRAVITY_CONFIG,
  CODEX_CONFIG,
  KIRO_CONFIG,
} from "@/lib/oauth/constants/oauth";

// OAuth provider test endpoints
const OAUTH_TEST_CONFIG = {
  claude: {
    // Claude doesn't have userinfo, we verify token exists and not expired
    checkExpiry: true,
  },
  codex: {
    url: "https://api.openai.com/v1/models",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: true,
  },
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
    url: "https://iflow.cn/api/oauth/getUserInfo",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
  },
  qwen: {
    url: "https://portal.qwen.ai/v1/models",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
  },
  kiro: {
    checkExpiry: true,
    refreshable: true,
  },
};

/**
 * Refresh OAuth token using refresh_token
 * @returns {object} { accessToken, expiresIn, refreshToken } or null if failed
 */
async function refreshOAuthToken(connection) {
  const provider = connection.provider;
  const refreshToken = connection.refreshToken;

  if (!refreshToken) return null;

  try {
    // Google-based providers (gemini-cli, antigravity)
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
      return {
        accessToken: data.access_token,
        expiresIn: data.expires_in,
        refreshToken: data.refresh_token || refreshToken,
      };
    }

    // OpenAI/Codex
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
      return {
        accessToken: data.access_token,
        expiresIn: data.expires_in,
        refreshToken: data.refresh_token || refreshToken,
      };
    }

    // Kiro (AWS SSO or Social auth)
    if (provider === "kiro") {
      const { clientId, clientSecret, region } = connection;

      // AWS SSO OIDC refresh (Builder ID or IDC)
      if (clientId && clientSecret) {
        const endpoint = `https://oidc.${region || "us-east-1"}.amazonaws.com/token`;
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId,
            clientSecret,
            refreshToken,
            grantType: "refresh_token",
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          console.log(`Kiro AWS SSO refresh failed: ${response.status} - ${errText}`);
          return null;
        }

        const data = await response.json();
        return {
          accessToken: data.accessToken,
          expiresIn: data.expiresIn || 3600,
          refreshToken: data.refreshToken || refreshToken,
        };
      }

      // Social auth refresh (Google/GitHub)
      const response = await fetch(KIRO_CONFIG.socialRefreshUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.log(`Kiro social refresh failed: ${response.status} - ${errText}`);
        return null;
      }

      const data = await response.json();
      return {
        accessToken: data.accessToken,
        expiresIn: data.expiresIn || 3600,
        refreshToken: data.refreshToken || refreshToken,
      };
    }

    return null;
  } catch (err) {
    console.log(`Error refreshing ${provider} token:`, err.message);
    return null;
  }
}

/**
 * Check if token is expired or about to expire (within 5 minutes)
 */
function isTokenExpired(connection) {
  if (!connection.expiresAt) return false;
  const expiresAt = new Date(connection.expiresAt).getTime();
  const buffer = 5 * 60 * 1000; // 5 minutes
  return expiresAt <= Date.now() + buffer;
}

/**
 * Sync to cloud if enabled
 */
async function syncToCloudIfEnabled() {
  try {
    const cloudEnabled = await isCloudEnabled();
    if (!cloudEnabled) return;

    const machineId = await getConsistentMachineId();
    await syncToCloud(machineId);
  } catch (error) {
    console.log("Error syncing to cloud after token refresh:", error);
  }
}

/**
 * Test OAuth connection by calling provider API
 * Auto-refreshes token if expired
 * @returns {{ valid: boolean, error: string|null, refreshed: boolean, newTokens: object|null }}
 */
async function testOAuthConnection(connection) {
  const config = OAUTH_TEST_CONFIG[connection.provider];

  if (!config) {
    return { valid: false, error: "Provider test not supported", refreshed: false };
  }

  // Check if token exists
  if (!connection.accessToken) {
    return { valid: false, error: "No access token", refreshed: false };
  }

  let accessToken = connection.accessToken;
  let refreshed = false;
  let newTokens = null;

  // Auto-refresh if token is expired and provider supports refresh
  const tokenExpired = isTokenExpired(connection);
  if (config.refreshable && tokenExpired && connection.refreshToken) {
    const tokens = await refreshOAuthToken(connection);
    if (tokens) {
      accessToken = tokens.accessToken;
      refreshed = true;
      newTokens = tokens;
    } else {
      // Refresh failed
      return { valid: false, error: "Token expired and refresh failed", refreshed: false };
    }
  }

  // For providers that only check expiry (no test endpoint available)
  if (config.checkExpiry) {
    // If we already refreshed successfully, token is valid
    if (refreshed) {
      return { valid: true, error: null, refreshed, newTokens };
    }
    // Check if token is expired (no refresh available)
    if (tokenExpired) {
      return { valid: false, error: "Token expired", refreshed: false };
    }
    return { valid: true, error: null, refreshed: false, newTokens: null };
  }

  // Call test endpoint
  try {
    const headers = {
      [config.authHeader]: `${config.authPrefix}${accessToken}`,
      ...config.extraHeaders,
    };

    const res = await fetch(config.url, {
      method: config.method,
      headers,
    });

    if (res.ok) {
      return { valid: true, error: null, refreshed, newTokens };
    }

    // If 401 and we haven't tried refresh yet, try refresh now
    if (res.status === 401 && config.refreshable && !refreshed && connection.refreshToken) {
      const tokens = await refreshOAuthToken(connection);
      if (tokens) {
        // Retry with new token
        const retryRes = await fetch(config.url, {
          method: config.method,
          headers: {
            [config.authHeader]: `${config.authPrefix}${tokens.accessToken}`,
            ...config.extraHeaders,
          },
        });

        if (retryRes.ok) {
          return { valid: true, error: null, refreshed: true, newTokens: tokens };
        }
      }
      return { valid: false, error: "Token invalid or revoked", refreshed: false };
    }

    if (res.status === 401) {
      return { valid: false, error: "Token invalid or revoked", refreshed };
    }
    if (res.status === 403) {
      return { valid: false, error: "Access denied", refreshed };
    }

    return { valid: false, error: `API returned ${res.status}`, refreshed };
  } catch (err) {
    return { valid: false, error: err.message, refreshed };
  }
}

/**
 * Test API key connection
 */
async function testApiKeyConnection(connection) {
  // OpenAI Compatible providers - test via /models endpoint
  if (isOpenAICompatibleProvider(connection.provider)) {
    const modelsBase = connection.providerSpecificData?.baseUrl;
    if (!modelsBase) {
      return { valid: false, error: "Missing base URL" };
    }
    try {
      const modelsUrl = `${modelsBase.replace(/\/$/, "")}/models`;
      const res = await fetch(modelsUrl, {
        headers: { "Authorization": `Bearer ${connection.apiKey}` },
      });
      return { valid: res.ok, error: res.ok ? null : "Invalid API key or base URL" };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  // Anthropic Compatible providers - test via /models endpoint
  if (isAnthropicCompatibleProvider(connection.provider)) {
    let modelsBase = connection.providerSpecificData?.baseUrl;
    if (!modelsBase) {
      return { valid: false, error: "Missing base URL" };
    }
    try {
      modelsBase = modelsBase.replace(/\/$/, "");
      if (modelsBase.endsWith("/messages")) {
        modelsBase = modelsBase.slice(0, -9);
      }
      
      const modelsUrl = `${modelsBase}/models`;
      const res = await fetch(modelsUrl, {
        headers: { 
          "x-api-key": connection.apiKey,
          "anthropic-version": "2023-06-01",
          "Authorization": `Bearer ${connection.apiKey}`
        },
      });
      return { valid: res.ok, error: res.ok ? null : "Invalid API key or base URL" };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  try {
    switch (connection.provider) {
      case "openai": {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${connection.apiKey}` },
        });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }

      case "anthropic": {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": connection.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 1,
            messages: [{ role: "user", content: "test" }],
          }),
        });
        const valid = res.status !== 401;
        return { valid, error: valid ? null : "Invalid API key" };
      }

      case "gemini": {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${connection.apiKey}`);
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }

      case "openrouter": {
        const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
          headers: { Authorization: `Bearer ${connection.apiKey}` },
        });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }

      case "glm": {
        // GLM uses Claude-compatible API at api.z.ai
        const res = await fetch("https://api.z.ai/api/anthropic/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": connection.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "glm-4.7",
            max_tokens: 1,
            messages: [{ role: "user", content: "test" }],
          }),
        });
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }

      case "minimax":
      case "minimax-cn": {
        // MiniMax uses Claude-compatible API
        const minimaxEndpoints = {
          minimax: "https://api.minimax.io/anthropic/v1/messages",
          "minimax-cn": "https://api.minimaxi.com/anthropic/v1/messages",
        };
        const res = await fetch(minimaxEndpoints[connection.provider], {
          method: "POST",
          headers: {
            "x-api-key": connection.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "minimax-m2",
            max_tokens: 1,
            messages: [{ role: "user", content: "test" }],
          }),
        });
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }

      case "kimi": {
        // Kimi uses Claude-compatible API
        const res = await fetch("https://api.kimi.com/coding/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": connection.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "kimi-latest",
            max_tokens: 1,
            messages: [{ role: "user", content: "test" }],
          }),
        });
        const valid = res.status !== 401 && res.status !== 403;
        return { valid, error: valid ? null : "Invalid API key" };
      }

      case "deepseek": {
        const res = await fetch("https://api.deepseek.com/models", {
          headers: { Authorization: `Bearer ${connection.apiKey}` },
        });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }

      case "groq": {
        const res = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${connection.apiKey}` },
        });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }

      case "mistral": {
        const res = await fetch("https://api.mistral.ai/v1/models", {
          headers: { Authorization: `Bearer ${connection.apiKey}` },
        });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }

      case "xai": {
        const res = await fetch("https://api.x.ai/v1/models", {
          headers: { Authorization: `Bearer ${connection.apiKey}` },
        });
        return { valid: res.ok, error: res.ok ? null : "Invalid API key" };
      }

      default:
        return { valid: false, error: "Provider test not supported" };
    }
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// POST /api/providers/[id]/test - Test connection
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    let result;

    if (connection.authType === "apikey") {
      result = await testApiKeyConnection(connection);
    } else {
      result = await testOAuthConnection(connection);
    }

    // Build update data
    const updateData = {
      testStatus: result.valid ? "active" : "error",
      lastError: result.valid ? null : result.error,
      lastErrorAt: result.valid ? null : new Date().toISOString(),
    };

    // If token was refreshed, update tokens in DB
    if (result.refreshed && result.newTokens) {
      updateData.accessToken = result.newTokens.accessToken;
      if (result.newTokens.refreshToken) {
        updateData.refreshToken = result.newTokens.refreshToken;
      }
      if (result.newTokens.expiresIn) {
        updateData.expiresAt = new Date(Date.now() + result.newTokens.expiresIn * 1000).toISOString();
      }
    }

    // Update status in db
    await updateProviderConnection(id, updateData);

    // Sync to cloud if token was refreshed
    if (result.refreshed) {
      await syncToCloudIfEnabled();
    }

    return NextResponse.json({
      valid: result.valid,
      error: result.error,
      refreshed: result.refreshed || false,
    });
  } catch (error) {
    console.log("Error testing connection:", error);
    return NextResponse.json({ error: "Test failed" }, { status: 500 });
  }
}
