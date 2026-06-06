import { PROVIDERS } from "../config/providers.js";
import {
  refreshAccessToken,
  refreshClaudeOAuthToken,
  refreshGoogleToken,
  refreshQwenToken,
  refreshCodexToken,
  refreshKiroToken,
  refreshIflowToken,
  refreshGitHubToken,
  refreshCopilotToken,
  refreshXaiToken,
} from "./refresh-providers.js";
import { parseVertexSaJson, refreshVertexToken } from "./refresh-vertex.js";

/**
 * Get access token for a specific provider (with in-flight dedup).
 * If a refresh is already in-flight for same provider+token, share the promise
 * to prevent parallel OAuth requests → Auth0 'refresh_token_reused' family revoke.
 */
export async function getAccessToken(provider, credentials, log) {
  if (
    !credentials ||
    !credentials.refreshToken ||
    typeof credentials.refreshToken !== "string"
  ) {
    log?.warn?.(
      "TOKEN_REFRESH",
      `No valid refresh token available for provider: ${provider}`,
    );
    return null;
  }
  // Dedup is handled inside each refreshXxxToken function
  return _getAccessTokenInternal(provider, credentials, log);
}

async function _getAccessTokenInternal(provider, credentials, log) {
  switch (provider) {
    case "gemini":
    case "gemini-cli":
    case "antigravity":
      return await refreshGoogleToken(
        credentials.refreshToken,
        PROVIDERS[provider].clientId,
        PROVIDERS[provider].clientSecret,
        log,
      );

    case "claude":
      return await refreshClaudeOAuthToken(credentials.refreshToken, log);

    case "codex":
      return await refreshCodexToken(credentials.refreshToken, log);

    case "qwen":
      return await refreshQwenToken(credentials.refreshToken, log);

    case "iflow":
      return await refreshIflowToken(credentials.refreshToken, log);

    case "github":
      return await refreshGitHubToken(credentials.refreshToken, log);

    case "kiro":
      return await refreshKiroToken(
        credentials.refreshToken,
        credentials.providerSpecificData,
        log,
      );

    case "xai":
      return await refreshXaiToken(credentials.refreshToken, log);

    case "vertex":
    case "vertex-partner": {
      const saJson = parseVertexSaJson(credentials.apiKey);
      if (!saJson) return null;
      return await refreshVertexToken(saJson, log);
    }

    default:
      log?.warn?.(
        "TOKEN_REFRESH",
        `Unsupported provider for token refresh: ${provider}`,
      );
      return null;
  }
}

/**
 * Refresh token by provider type (helper for handlers)
 */
export async function refreshTokenByProvider(provider, credentials, log) {
  if (!credentials.refreshToken) return null;

  switch (provider) {
    case "gemini-cli":
    case "antigravity":
      return refreshGoogleToken(
        credentials.refreshToken,
        PROVIDERS[provider].clientId,
        PROVIDERS[provider].clientSecret,
        log,
      );
    case "claude":
      return refreshClaudeOAuthToken(credentials.refreshToken, log);
    case "codex":
      return refreshCodexToken(credentials.refreshToken, log);
    case "qwen":
      return refreshQwenToken(credentials.refreshToken, log);
    case "iflow":
      return refreshIflowToken(credentials.refreshToken, log);
    case "github":
      return refreshGitHubToken(credentials.refreshToken, log);
    case "kiro":
      return refreshKiroToken(
        credentials.refreshToken,
        credentials.providerSpecificData,
        log,
      );
    case "xai":
      return refreshXaiToken(credentials.refreshToken, log);
    case "vertex":
    case "vertex-partner": {
      const saJson = parseVertexSaJson(credentials.apiKey);
      if (!saJson) return null;
      return refreshVertexToken(saJson, log);
    }
    default:
      return refreshAccessToken(
        provider,
        credentials.refreshToken,
        credentials,
        log,
      );
  }
}

/**
 * Format credentials for provider
 */
export function formatProviderCredentials(provider, credentials, log) {
  const config = PROVIDERS[provider];
  if (!config) {
    log?.warn?.(
      "TOKEN_REFRESH",
      `No configuration found for provider: ${provider}`,
    );
    return null;
  }

  switch (provider) {
    case "gemini":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken,
        projectId: credentials.projectId,
      };

    case "claude":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken,
      };

    case "codex":
    case "qwen":
    case "iflow":
    case "openai":
    case "openrouter":
    case "xai":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken,
      };

    case "antigravity":
    case "gemini-cli":
      return {
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        projectId: credentials.projectId,
      };

    default:
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
      };
  }
}

/**
 * Get all access tokens for a user
 */
export async function getAllAccessTokens(userInfo, log) {
  const results = {};

  if (userInfo.connections && Array.isArray(userInfo.connections)) {
    for (const connection of userInfo.connections) {
      if (connection.isActive && connection.provider) {
        const token = await getAccessToken(
          connection.provider,
          {
            refreshToken: connection.refreshToken,
          },
          log,
        );

        if (token) {
          results[connection.provider] = token;
        }
      }
    }
  }

  return results;
}

/**
 * Refresh token with retry and exponential backoff
 * Retries on failure with increasing delay: 1s, 2s, 3s...
 * @param {function} refreshFn - Async function that returns token or null
 * @param {number} maxRetries - Max retry attempts (default 3)
 * @param {object} log - Logger instance (optional)
 * @returns {Promise<object|null>} Token result or null if all retries fail
 */
export async function refreshWithRetry(refreshFn, maxRetries = 3, log = null) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = attempt * 1000;
      log?.debug?.(
        "TOKEN_REFRESH",
        `Retry ${attempt}/${maxRetries} after ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const result = await refreshFn();
      if (result) return result;
    } catch (error) {
      log?.warn?.(
        "TOKEN_REFRESH",
        `Attempt ${attempt + 1}/${maxRetries} failed: ${error.message}`,
      );
    }
  }

  log?.error?.("TOKEN_REFRESH", `All ${maxRetries} retry attempts failed`);
  return null;
}
