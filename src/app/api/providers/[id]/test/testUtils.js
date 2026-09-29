import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { testProxyUrl } from "@/lib/network/proxyTest";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { PROVIDERS } from "open-sse/config/providers.js";
import { CODEX_CLI_VERSION } from "open-sse/config/appConstants.js";
import { sanitizeOpenAICompatibleBaseUrl, openaiCompatFetchHeaders } from "open-sse/providers/shared.js";
import { probeConnection, probeOpenAICompatBaseUrl, probeAnthropicCompatBaseUrl } from "@/lib/providers/connectionProbe";
import {
  refreshProviderCredentials,
  shouldRefreshCredentials,
} from "open-sse/services/oauthCredentialManager.js";
import {
  GEMINI_CONFIG,
  ANTIGRAVITY_CONFIG,
  KIRO_CONFIG,
  CLAUDE_CONFIG,
  CLINE_CONFIG,
  KILOCODE_CONFIG,
  KIMCHI_CONFIG,
} from "@/lib/oauth/constants/oauth";
import { buildClineHeaders } from "@/shared/utils/clineAuth";

// OAuth provider test endpoints
const OAUTH_TEST_CONFIG = {
  claude: { checkExpiry: true, refreshable: true },
  codex: {
    url: "https://chatgpt.com/backend-api/codex/responses",
    method: "POST",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: { "Content-Type": "application/json", "originator": "codex_cli_rs", "User-Agent": `codex_cli_rs/${CODEX_CLI_VERSION}` },
    // Minimal invalid body — triggers fast 400 without consuming quota
    body: JSON.stringify({ model: "gpt-5.3-codex", input: [], stream: false, store: false }),
    // 400 (bad request) means auth succeeded; only 401/403 means token is bad
    acceptStatuses: [400],
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
    // iFlow getUserInfo requires accessToken as query param, not header
    buildUrl: (token) => `https://iflow.cn/api/oauth/getUserInfo?accessToken=${encodeURIComponent(token)}`,
    method: "GET",
    noAuth: true,
  },
  kiro: { checkExpiry: true, refreshable: true },
  qoder: {
    // Test by hitting Qoder's userinfo endpoint with the device token.
    // refreshable: false because the device-flow refresh endpoint returns
    // 403 for our flow (users re-login when expired). No checkExpiry —
    // we want the actual URL probe to run so revoked tokens surface.
    url: "https://openapi.qoder.sh/api/v1/userinfo",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: false,
  },
  kimi: { checkExpiry: true, refreshable: true },
  "kimi-coding": { checkExpiry: true, refreshable: true },
  cursor: { tokenExists: true },
  kilocode: {
    url: `${KILOCODE_CONFIG.apiBaseUrl}/api/profile`,
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
  },
  cline: { refreshable: true },
  gitlab: {
    // Test by hitting the GitLab user API — requires api or read_user scope
    url: "https://gitlab.com/api/v4/user",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
  },
  "codebuddy-cn": { tokenExists: true },
  kimchi: {
    url: KIMCHI_CONFIG.validationUrl || "https://api.cast.ai/v1/llm/openai/supported-providers",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: {
      Accept: "application/json",
      "User-Agent": "kimchi/0.1.40",
    },
    refreshable: false,
  },
  // Grok CLI / Grok Build — probe /v1/user (no inference quota). Headers mirror official CLI.
  "grok-cli": {
    url: PROVIDERS["grok-cli"]?.userUrl || "https://cli-chat-proxy.grok.com/v1/user",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: {
      Accept: "application/json",
      ...(PROVIDERS["grok-cli"]?.headers || {
        "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
        "x-xai-token-auth": "xai-grok-cli",
        "x-grok-client-identifier": "grok-pager",
        "x-grok-client-version": "0.2.93",
      }),
    },
    refreshable: true,
    // Subscription spending-limit is not an auth failure — token is fine, credits aren't.
    // Accept 402 so the connection stays "active" with a warning (same idea as Codex 400).
    acceptStatuses: [402],
    softFailMessage: {
      402: "Connected, but Grok Build credits are exhausted (spending limit). Add credits or upgrade SuperGrok.",
    },
  },
};

/**
 * Classify an OAuth probe response as success / soft-success / hard-fail.
 * Soft success (e.g. 402 spending-limit on Grok CLI) means auth works but the
 * account cannot spend — keep connection active and surface a warning.
 * Exported for unit tests.
 */
export function classifyOAuthProbeResult(res, config, bodyText = "") {
  if (!res) return { valid: false, error: "No response", soft: false };
  const status = res.status;
  const accepted = res.ok || (config?.acceptStatuses && config.acceptStatuses.includes(status));
  if (!accepted) {
    if (status === 401) return { valid: false, error: "Token invalid or revoked", soft: false };
    if (status === 403) return { valid: false, error: "Access denied", soft: false };
    return { valid: false, error: `API returned ${status}`, soft: false };
  }

  // Soft success only when the provider configured an explicit message for this
  // status (e.g. Grok CLI 402 spending-limit). Codex-style acceptStatuses:[400]
  // stays silent success — 400 there only proves auth, not a user-facing warning.
  if (!res.ok && config?.acceptStatuses?.includes(status)) {
    const softMap = config.softFailMessage || {};
    if (softMap[status]) {
      return { valid: true, error: softMap[status], soft: true };
    }
    return { valid: true, error: null, soft: false };
  }

  return { valid: true, error: null, soft: false };
}

async function probeClineAccessToken(accessToken) {
  const res = await fetch("https://api.cline.bot/api/v1/users/me", {
    method: "GET",
    headers: buildClineHeaders(accessToken, {
      Accept: "application/json",
    }),
  });

  return res;
}

const CLOUD_CODE_ASSIST_TEST_URL = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const CLOUD_CODE_ASSIST_TEST_BODY = JSON.stringify({
  metadata: {
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
  },
});

function parseProviderErrorMessage(bodyText, fallback) {
  if (!bodyText) return fallback;
  try {
    const parsed = JSON.parse(bodyText);
    const message = parsed?.error?.message || parsed?.message || parsed?.error;
    if (typeof message === "string" && message.trim()) return message.trim();
    if (message) return JSON.stringify(message);
  } catch {
    // fall through
  }
  return bodyText.trim() || fallback;
}

async function probeCloudCodeAssistAccess(connection, accessToken, effectiveProxy = null) {
  const userAgent = connection.provider === "antigravity"
    ? "google-api-nodejs-client/9.15.1 vscode-antigravity/1.107.0"
    : "google-api-nodejs-client/9.15.1 gemini-cli/0.34.0";

  const res = await fetchWithConnectionProxy(CLOUD_CODE_ASSIST_TEST_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": userAgent,
    },
    body: CLOUD_CODE_ASSIST_TEST_BODY,
  }, effectiveProxy);

  if (res.ok) return { valid: true, error: null };

  const bodyText = await res.text().catch(() => "");
  return {
    valid: false,
    error: parseProviderErrorMessage(bodyText, `API returned ${res.status}`),
    status: res.status,
  };
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

    if (provider === "codex" || provider === "grok-cli" || provider === "xai") {
      return await refreshProviderCredentials(provider, connection, console);
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
  return shouldRefreshCredentials(connection.provider, connection);
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

  if (connection.provider === "gemini-cli" || connection.provider === "antigravity") {
    const initial = await probeCloudCodeAssistAccess(connection, accessToken, effectiveProxy);
    if (initial.valid) return { valid: true, error: null, refreshed, newTokens };

    if (initial.status === 401 && config.refreshable && !refreshed && connection.refreshToken) {
      const tokens = await refreshOAuthToken(connection);
      if (tokens?.accessToken) {
        const retry = await probeCloudCodeAssistAccess(connection, tokens.accessToken, effectiveProxy);
        if (retry.valid) return { valid: true, error: null, refreshed: true, newTokens: tokens };
        return { valid: false, error: retry.error, refreshed: true, newTokens: tokens };
      }
      return { valid: false, error: "Token invalid or revoked", refreshed: false };
    }

    return { valid: false, error: initial.error, refreshed };
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
    const fetchOpts = { method: config.method, headers };
    if (config.body) fetchOpts.body = config.body;
    const res = await fetchWithConnectionProxy(testUrl, fetchOpts, effectiveProxy);
    const bodyText = !res.ok ? await res.text().catch(() => "") : "";

    const classified = classifyOAuthProbeResult(res, config, bodyText);
    if (classified.valid) {
      return {
        valid: true,
        // soft success surfaces warning text without marking connection error
        error: classified.soft ? classified.error : null,
        warning: classified.soft ? classified.error : null,
        refreshed,
        newTokens,
      };
    }

    if (res.status === 401 && config.refreshable && !refreshed && connection.refreshToken) {
      const tokens = await refreshOAuthToken(connection);
      if (tokens) {
        const retryUrl = config.buildUrl ? config.buildUrl(tokens.accessToken) : testUrl;
        const retryHeaders = config.noAuth
          ? { ...config.extraHeaders }
          : { [config.authHeader]: `${config.authPrefix}${tokens.accessToken}`, ...config.extraHeaders };
        const retryOpts = { method: config.method, headers: retryHeaders };
        if (config.body) retryOpts.body = config.body;
        const retryRes = await fetchWithConnectionProxy(retryUrl, retryOpts, effectiveProxy);
        const retryBody = !retryRes.ok ? await retryRes.text().catch(() => "") : "";
        const retryClassified = classifyOAuthProbeResult(retryRes, config, retryBody);
        if (retryClassified.valid) {
          return {
            valid: true,
            error: retryClassified.soft ? retryClassified.error : null,
            warning: retryClassified.soft ? retryClassified.error : null,
            refreshed: true,
            newTokens: tokens,
          };
        }
      }
      return { valid: false, error: "Token invalid or revoked", refreshed: false };
    }

    return { valid: false, error: classified.error, refreshed };
  } catch (err) {
    return { valid: false, error: err.message, refreshed };
  }
}

async function fetchWithConnectionProxy(url, options = {}, effectiveProxy = null) {
  // Vercel relay: forward via relay URL
  if (effectiveProxy?.vercelRelayUrl) {
    const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");
    return proxyAwareFetch(url, options, {
      vercelRelayUrl: effectiveProxy.vercelRelayUrl,
    });
  }

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
  const fetchImpl = (url, opts) => fetchWithConnectionProxy(url, opts, effectiveProxy);

  if (isOpenAICompatibleProvider(connection.provider)) {
    const modelsBase = connection.providerSpecificData?.baseUrl;
    if (!modelsBase) return { valid: false, error: "Missing base URL" };
    try {
      return await probeOpenAICompatBaseUrl(sanitizeOpenAICompatibleBaseUrl(modelsBase), connection.apiKey, fetchImpl, openaiCompatFetchHeaders(connection.apiKey));
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  if (isAnthropicCompatibleProvider(connection.provider)) {
    const modelsBase = connection.providerSpecificData?.baseUrl;
    if (!modelsBase) return { valid: false, error: "Missing base URL" };
    try {
      return await probeAnthropicCompatBaseUrl(modelsBase, connection.apiKey, connection.defaultModel, fetchImpl);
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  try {
    return await probeConnection(connection.provider, connection.apiKey, {
      providerSpecificData: connection.providerSpecificData,
      fetchImpl,
    });
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

  if (effectiveProxy.connectionProxyEnabled && effectiveProxy.connectionProxyUrl && !effectiveProxy.vercelRelayUrl) {
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

  if (connection.authType === "apikey" || connection.authType === "cookie") {
    result = await testApiKeyConnection(connection, effectiveProxy);
  } else {
    result = await testOAuthConnection(connection, effectiveProxy);
  }

  const latencyMs = Date.now() - start;

  // Soft success (e.g. Grok CLI 402 spending-limit): credentials are good, account is
  // out of credits. Keep testStatus active; surface the message as lastError so the
  // dashboard can show a warning without marking the connection broken.
  const softWarning = result.valid && (result.warning || result.error);
  const updateData = {
    testStatus: result.valid ? "active" : "error",
    lastError: result.valid ? (softWarning || null) : result.error,
    lastErrorAt: result.valid
      ? softWarning
        ? new Date().toISOString()
        : null
      : new Date().toISOString(),
  };

  if (result.refreshed && result.newTokens) {
    if (result.newTokens.accessToken) updateData.accessToken = result.newTokens.accessToken;
    if (result.newTokens.refreshToken) updateData.refreshToken = result.newTokens.refreshToken;
    if (result.newTokens.idToken) updateData.idToken = result.newTokens.idToken;
    if (result.newTokens.lastRefreshAt) updateData.lastRefreshAt = result.newTokens.lastRefreshAt;
    if (result.newTokens.expiresIn) updateData.expiresIn = result.newTokens.expiresIn;
    if (result.newTokens.expiresIn) {
      updateData.expiresAt = new Date(Date.now() + result.newTokens.expiresIn * 1000).toISOString();
    } else if (result.newTokens.expiresAt) {
      updateData.expiresAt = result.newTokens.expiresAt;
    }
    if (result.newTokens.providerSpecificData) {
      updateData.providerSpecificData = {
        ...(connection.providerSpecificData || {}),
        ...result.newTokens.providerSpecificData,
      };
    }
  }

  await updateProviderConnection(id, updateData);

  return { valid: result.valid, error: result.error, refreshed: !!result.refreshed, latencyMs, testedAt: new Date().toISOString() };
}
