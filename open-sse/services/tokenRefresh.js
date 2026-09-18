import { PROVIDERS } from "../config/providers.js";
import { OAUTH_ENDPOINTS, REFRESH_LEAD_MS } from "../config/appConstants.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import {
  refreshXaiToken,
  refreshAccessToken,
  refreshKimiToken,
  refreshClaudeOAuthToken,
  refreshGoogleToken,
  refreshCodexToken,
  refreshKiroToken,
  refreshIflowToken,
  refreshGitHubToken,
  refreshCopilotToken,
  refreshCodebuddyToken,
  refreshCodebuddyIntlToken,
  refreshTraeToken,
  refreshZedToken,
  refreshWindsurfToken,
  classifyOAuthRefreshError,
} from "./tokenRefresh/providers.js";

// Re-export all provider refresh functions (preserves public API for all consumers)
export {
  refreshAccessToken,
  refreshKimiToken,
  refreshClaudeOAuthToken,
  refreshGoogleToken,
  refreshCodexToken,
  refreshKiroToken,
  refreshIflowToken,
  refreshGitHubToken,
  refreshCopilotToken,
  refreshCodebuddyToken,
  refreshCodebuddyIntlToken,
  refreshTraeToken,
  refreshZedToken,
  refreshWindsurfToken,
  classifyOAuthRefreshError,
};

export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export function isUnrecoverableRefreshError(result) {
  return (
    result &&
    typeof result === "object" &&
    (result.error === "unrecoverable_refresh_error" ||
      result.error === "refresh_token_reused" ||
      result.error === "invalid_request" ||
      result.error === "invalid_grant")
  );
}

export function getRefreshLeadMs(provider) {
  if (REFRESH_LEAD_MS[provider]) return REFRESH_LEAD_MS[provider];
  // Legacy id after kimi-coding → kimi merge
  if (provider === "kimi-coding" && REFRESH_LEAD_MS.kimi) return REFRESH_LEAD_MS.kimi;
  return TOKEN_EXPIRY_BUFFER_MS;
}

export function parseVertexSaJson(apiKey) {
  if (typeof apiKey !== "string") return null;
  try {
    const parsed = JSON.parse(apiKey);
    if (parsed.type === "service_account" && parsed.client_email && parsed.private_key && parsed.project_id) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

// Cache Vertex tokens keyed by service account email { token, expiresAt }
const vertexTokenCache = new Map();

export async function refreshVertexToken(saJson, log, proxyOptions = null) {
  const cacheKey = saJson.client_email;
  const cached = vertexTokenCache.get(cacheKey);

  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) {
    return { accessToken: cached.token, expiresAt: cached.expiresAt };
  }

  try {
    const { SignJWT, importPKCS8 } = await import("jose");
    log?.debug?.("TOKEN_REFRESH", `Vertex minting token for ${saJson.client_email}`);
    const privateKey = await importPKCS8(saJson.private_key.replace(/\\n/g, "\n"), "RS256");
    const now = Math.floor(Date.now() / 1000);

    const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/cloud-platform" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(saJson.client_email)
      .setAudience(OAUTH_ENDPOINTS.google.token)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(privateKey);

    const res = await proxyAwareFetch(OAUTH_ENDPOINTS.google.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    }, proxyOptions);

    if (!res.ok) {
      const err = await res.text();
      log?.error?.("TOKEN_REFRESH", `Vertex token mint failed: ${err}`);
      return null;
    }

    const { access_token, expires_in } = await res.json();
    const expiresAt = Date.now() + (expires_in ?? 3600) * 1000;

    vertexTokenCache.set(cacheKey, { token: access_token, expiresAt });
    log?.info?.("TOKEN_REFRESH", `Vertex token minted for ${saJson.client_email}`);

    return { accessToken: access_token, expiresAt };
  } catch (error) {
    log?.error?.("TOKEN_REFRESH", `Vertex token error: ${error.message}`);
    return null;
  }
}

function vertexRefreshHandler(c, log, proxyOptions = null) {
  const saJson = parseVertexSaJson(c.apiKey);
  if (!saJson) return null;
  return refreshVertexToken(saJson, log, proxyOptions);
}

// Every handler takes (credentials, log, proxyOptions). proxyOptions carries the
// connection's proxy pool so the OAuth refresh leaves through the same egress as
// the chat request itself — without it the provider sees the real IP on refresh.
const REFRESH_HANDLERS = {
  "gemini-cli": (c, log, px) => refreshGoogleToken(c.refreshToken, PROVIDERS["gemini-cli"].clientId, PROVIDERS["gemini-cli"].clientSecret, log, px),
  antigravity: (c, log, px) => refreshGoogleToken(c.refreshToken, PROVIDERS.antigravity.clientId, PROVIDERS.antigravity.clientSecret, log, px),
  claude: (c, log, px) => refreshClaudeOAuthToken(c.refreshToken, log, px),
  codex: (c, log, px) => refreshCodexToken(c.refreshToken, log, px),
  iflow: (c, log, px) => refreshIflowToken(c.refreshToken, log, px),
  github: (c, log, px) => refreshGitHubToken(c.refreshToken, log, px),
  kiro: (c, log, px) => refreshKiroToken(c.refreshToken, c.providerSpecificData, log, px),
  xai: (c, log, px) => refreshXaiToken(c.refreshToken, log, px),
  // Grok CLI shares xAI OAuth client + token endpoint (device-code tokens refresh the same way)
  "grok-cli": (c, log, px) => refreshXaiToken(c.refreshToken, log, px),
  gcli: (c, log, px) => refreshXaiToken(c.refreshToken, log, px),
  "codebuddy-cn": (c, log, px) => refreshCodebuddyToken(c.refreshToken, log, px),
  "codebuddy-intl": (c, log, px) => refreshCodebuddyIntlToken(c.refreshToken, log, px),
  trae: (c, log, px) => refreshTraeToken(c.refreshToken, c, log, px),
  zed: () => refreshZedToken(),
  windsurf: (c, log, px) => refreshWindsurfToken(c, log, px),
  // Kimi Code OAuth (merged into id `kimi`); legacy id still routes here
  kimi: (c, log, px) => refreshKimiToken(c.refreshToken, c, log, px),
  "kimi-coding": (c, log, px) => refreshKimiToken(c.refreshToken, c, log, px),
  vertex: vertexRefreshHandler,
  "vertex-partner": vertexRefreshHandler
};

export async function getAccessToken(provider, credentials, log, proxyOptions = null) {
  if (!credentials || !credentials.refreshToken || typeof credentials.refreshToken !== "string") {
    log?.warn?.("TOKEN_REFRESH", `No valid refresh token available for provider: ${provider}`);
    return null;
  }
  return _getAccessTokenInternal(provider, credentials, log, proxyOptions);
}

async function _getAccessTokenInternal(provider, credentials, log, proxyOptions = null) {
  if (provider === "gemini") {
    return refreshGoogleToken(credentials.refreshToken, PROVIDERS.gemini.clientId, PROVIDERS.gemini.clientSecret, log, proxyOptions);
  }
  const handler = REFRESH_HANDLERS[provider];
  if (!handler) {
    log?.warn?.("TOKEN_REFRESH", `Unsupported provider for token refresh: ${provider}`);
    return null;
  }
  return handler(credentials, log, proxyOptions);
}

export async function refreshTokenByProvider(provider, credentials, log, proxyOptions = null) {
  if (!credentials.refreshToken) return null;
  const handler = REFRESH_HANDLERS[provider];
  return handler
    ? handler(credentials, log, proxyOptions)
    : refreshAccessToken(provider, credentials.refreshToken, credentials, log, proxyOptions);
}

export function formatProviderCredentials(provider, credentials, log) {
  const config = PROVIDERS[provider];
  if (!config) {
    log?.warn?.("TOKEN_REFRESH", `No configuration found for provider: ${provider}`);
    return null;
  }

  switch (provider) {
    case "gemini":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken,
        projectId: credentials.projectId
      };

    case "claude":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken
      };

    case "codex":
    case "iflow":
    case "openai":
    case "openrouter":
    case "xai":
    case "grok-cli":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken
      };

    case "antigravity":
    case "gemini-cli":
      return {
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        projectId: credentials.projectId
      };

    default:
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken
      };
  }
}

export async function getAllAccessTokens(userInfo, log) {
  const results = {};

  if (userInfo.connections && Array.isArray(userInfo.connections)) {
    for (const connection of userInfo.connections) {
      if (connection.isActive && connection.provider) {
        const token = await getAccessToken(connection.provider, {
          refreshToken: connection.refreshToken
        }, log);

        if (token) {
          results[connection.provider] = token;
        }
      }
    }
  }

  return results;
}

export async function refreshWithRetry(refreshFn, maxRetries = 3, log = null) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = attempt * 1000;
      log?.debug?.("TOKEN_REFRESH", `Retry ${attempt}/${maxRetries} after ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }

    try {
      const result = await refreshFn();
      if (result) return result;
    } catch (error) {
      log?.warn?.("TOKEN_REFRESH", `Attempt ${attempt + 1}/${maxRetries} failed: ${error.message}`);
    }
  }

  log?.error?.("TOKEN_REFRESH", `All ${maxRetries} retry attempts failed`);
  return null;
}
