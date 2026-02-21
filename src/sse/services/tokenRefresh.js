// Re-export from open-sse with local logger
import * as log from "../utils/logger.js";
import { updateProviderConnection } from "../../lib/localDb.js";
import {
  getProjectIdForConnection,
  invalidateProjectId,
  removeConnection,
} from "open-sse/services/projectId.js";
import {
  TOKEN_EXPIRY_BUFFER_MS as BUFFER_MS,
  refreshAccessToken as _refreshAccessToken,
  refreshClaudeOAuthToken as _refreshClaudeOAuthToken,
  refreshGoogleToken as _refreshGoogleToken,
  refreshQwenToken as _refreshQwenToken,
  refreshCodexToken as _refreshCodexToken,
  refreshIflowToken as _refreshIflowToken,
  refreshGitHubToken as _refreshGitHubToken,
  refreshCopilotToken as _refreshCopilotToken,
  getAccessToken as _getAccessToken,
  refreshTokenByProvider as _refreshTokenByProvider,
  formatProviderCredentials as _formatProviderCredentials,
  getAllAccessTokens as _getAllAccessTokens
} from "open-sse/services/tokenRefresh.js";

export const TOKEN_EXPIRY_BUFFER_MS = BUFFER_MS;

// ─── Re-exports wrapped with local logger ─────────────────────────────────────

export const refreshAccessToken = (provider, refreshToken, credentials) =>
  _refreshAccessToken(provider, refreshToken, credentials, log);

export const refreshClaudeOAuthToken = (refreshToken) =>
  _refreshClaudeOAuthToken(refreshToken, log);

export const refreshGoogleToken = (refreshToken, clientId, clientSecret) =>
  _refreshGoogleToken(refreshToken, clientId, clientSecret, log);

export const refreshQwenToken = (refreshToken) =>
  _refreshQwenToken(refreshToken, log);

export const refreshCodexToken = (refreshToken) =>
  _refreshCodexToken(refreshToken, log);

export const refreshIflowToken = (refreshToken) =>
  _refreshIflowToken(refreshToken, log);

export const refreshGitHubToken = (refreshToken) =>
  _refreshGitHubToken(refreshToken, log);

export const refreshCopilotToken = (githubAccessToken) =>
  _refreshCopilotToken(githubAccessToken, log);

export const getAccessToken = (provider, credentials) =>
  _getAccessToken(provider, credentials, log);

export const refreshTokenByProvider = (provider, credentials) =>
  _refreshTokenByProvider(provider, credentials, log);

export const formatProviderCredentials = (provider, credentials) =>
  _formatProviderCredentials(provider, credentials, log);

export const getAllAccessTokens = (userInfo) =>
  _getAllAccessTokens(userInfo, log);

// ─── Lifecycle hook ───────────────────────────────────────────────────────────

/**
 * Call this when a connection is fully closed / removed.
 * Aborts any in-flight projectId fetch and evicts its cache entry,
 * preventing the module-level Maps from accumulating stale entries.
 *
 * @param {string} connectionId
 */
export function releaseConnection(connectionId) {
  if (!connectionId) return;
  removeConnection(connectionId);
  log.debug("TOKEN_REFRESH", "Released connection resources", { connectionId });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Compute an ISO expiry timestamp from a relative expiresIn (seconds).
 * @param {number} expiresIn
 * @returns {string}
 */
function toExpiresAt(expiresIn) {
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

/**
 * Providers that carry a real Google project ID.
 * @param {string} provider
 * @returns {boolean}
 */
function needsProjectId(provider) {
  return provider === "antigravity" || provider === "gemini-cli";
}

/**
 * Non-blocking: fetch the project ID for a connection after a token refresh and
 * persist it to localDb.  Invalidates the stale cached value first so the fetch
 * always retrieves a fresh one.
 *
 * @param {string} provider
 * @param {string} connectionId
 * @param {string} accessToken
 */
function _refreshProjectId(provider, connectionId, accessToken) {
  if (!needsProjectId(provider) || !connectionId || !accessToken) return;

  // Evict the stale cached entry so getProjectIdForConnection does a real fetch
  invalidateProjectId(connectionId);

  getProjectIdForConnection(connectionId, accessToken)
    .then((projectId) => {
      if (!projectId) return;
      updateProviderCredentials(connectionId, { projectId }).catch((err) => {
        log.debug("TOKEN_REFRESH", "Failed to persist refreshed projectId", {
          connectionId,
          error: err?.message ?? err,
        });
      });
    })
    .catch((err) => {
      log.debug("TOKEN_REFRESH", "Failed to fetch projectId after token refresh", {
        connectionId,
        error: err?.message ?? err,
      });
    });
}

// ─── Local-specific: persist credentials to localDb ──────────────────────────

/**
 * Persist updated credentials for a connection to localDb.
 * Only fields that are present in `newCredentials` are written.
 *
 * @param {string} connectionId
 * @param {object} newCredentials
 * @returns {Promise<boolean>}
 */
export async function updateProviderCredentials(connectionId, newCredentials) {
  try {
    const updates = {};

    if (newCredentials.accessToken)         updates.accessToken  = newCredentials.accessToken;
    if (newCredentials.refreshToken)        updates.refreshToken = newCredentials.refreshToken;
    if (newCredentials.expiresIn) {
      updates.expiresAt = toExpiresAt(newCredentials.expiresIn);
      updates.expiresIn = newCredentials.expiresIn;
    }
    if (newCredentials.providerSpecificData) updates.providerSpecificData = newCredentials.providerSpecificData;
    if (newCredentials.projectId)            updates.projectId = newCredentials.projectId;

    const result = await updateProviderConnection(connectionId, updates);
    log.info("TOKEN_REFRESH", "Credentials updated in localDb", {
      connectionId,
      success: !!result
    });
    return !!result;
  } catch (error) {
    log.error("TOKEN_REFRESH", "Error updating credentials in localDb", {
      connectionId,
      error: error.message,
    });
    return false;
  }
}

// ─── Local-specific: proactive token refresh ─────────────────────────────────

/**
 * Check whether the provider token (and, for GitHub, the Copilot token) is
 * about to expire and refresh it proactively.
 *
 * @param {string} provider
 * @param {object} credentials
 * @returns {Promise<object>} updated credentials object
 */
export async function checkAndRefreshToken(provider, credentials) {
  let creds = { ...credentials };

  // ── 1. Regular access-token expiry ────────────────────────────────────────
  if (creds.expiresAt) {
    const expiresAt = new Date(creds.expiresAt).getTime();
    const now       = Date.now();
    const remaining = expiresAt - now;

    if (remaining < TOKEN_EXPIRY_BUFFER_MS) {
      log.info("TOKEN_REFRESH", "Token expiring soon, refreshing proactively", {
        provider,
        expiresIn: Math.round(remaining / 1000),
      });

      const newCreds = await getAccessToken(provider, creds);
      if (newCreds?.accessToken) {
        // Persist to DB (non-blocking path continues below)
        await updateProviderCredentials(creds.connectionId, newCreds);

        creds = {
          ...creds,
          accessToken:  newCreds.accessToken,
          refreshToken: newCreds.refreshToken ?? creds.refreshToken,
          expiresAt:    newCreds.expiresIn
            ? toExpiresAt(newCreds.expiresIn)
            : creds.expiresAt,
        };

        // Non-blocking: refresh projectId with the new access token
        _refreshProjectId(provider, creds.connectionId, creds.accessToken);
      }
    }
  }

  // ── 2. GitHub Copilot token expiry ────────────────────────────────────────
  if (provider === "github" && creds.providerSpecificData?.copilotTokenExpiresAt) {
    const copilotExpiresAt = creds.providerSpecificData.copilotTokenExpiresAt * 1000;
    const now              = Date.now();
    const remaining        = copilotExpiresAt - now;

    if (remaining < TOKEN_EXPIRY_BUFFER_MS) {
      log.info("TOKEN_REFRESH", "Copilot token expiring soon, refreshing proactively", {
        provider,
        expiresIn: Math.round(remaining / 1000),
      });

      const copilotToken = await refreshCopilotToken(creds.accessToken);
      if (copilotToken) {
        const updatedSpecific = {
          ...creds.providerSpecificData,
          copilotToken:          copilotToken.token,
          copilotTokenExpiresAt: copilotToken.expiresAt,
        };

        await updateProviderCredentials(creds.connectionId, {
          providerSpecificData: updatedSpecific,
        });

        creds.providerSpecificData = updatedSpecific;
      }
    }
  }

  return creds;
}

// ─── Local-specific: combined GitHub + Copilot refresh ───────────────────────

/**
 * Refresh the GitHub OAuth token and immediately exchange it for a fresh
 * Copilot token.
 *
 * @param {object} credentials  – must contain `refreshToken`
 * @returns {Promise<object|null>} merged credentials or the raw GitHub credentials on Copilot failure
 */
export async function refreshGitHubAndCopilotTokens(credentials) {
  const newGitHubCreds = await refreshGitHubToken(credentials.refreshToken);
  if (!newGitHubCreds?.accessToken) return newGitHubCreds;

  const copilotToken = await refreshCopilotToken(newGitHubCreds.accessToken);
  if (!copilotToken) return newGitHubCreds;

  return {
    ...newGitHubCreds,
    providerSpecificData: {
      copilotToken:          copilotToken.token,
      copilotTokenExpiresAt: copilotToken.expiresAt,
    },
  };
}
