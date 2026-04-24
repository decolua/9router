// Re-export from open-sse with local logger
import * as log from "../utils/logger";
import { updateProviderConnection } from "@/lib/localDb";
import {
  getProjectId as getProjectIdForConnection,
  invalidateProjectId,
  removeConnection,
} from "@/lib/open-sse/services/projectId";
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
  refreshKiroToken as _refreshKiroToken,
  getRefreshLeadMs as _getRefreshLeadMs,
  type TokenResult
} from "@/lib/open-sse/services/tokenRefresh";

export const TOKEN_EXPIRY_BUFFER_MS = BUFFER_MS;

// ─── Re-exports wrapped with local logger ─────────────────────────────────────

export const refreshAccessToken = (provider: string, refreshToken: string, credentials: any) =>
  _refreshAccessToken(provider, refreshToken, credentials, log);

export const refreshClaudeOAuthToken = (refreshToken: string) =>
  _refreshClaudeOAuthToken(refreshToken, log);

export const refreshGoogleToken = (refreshToken: string, clientId: string, clientSecret: string) =>
  _refreshGoogleToken(refreshToken, clientId, clientSecret, log);

export const refreshQwenToken = (refreshToken: string) =>
  _refreshQwenToken(refreshToken, log);

export const refreshCodexToken = (refreshToken: string) =>
  _refreshCodexToken(refreshToken, log);

export const refreshIflowToken = (refreshToken: string) =>
  _refreshIflowToken(refreshToken, log);

export const refreshGitHubToken = (refreshToken: string) =>
  _refreshGitHubToken(refreshToken, log);

export const refreshCopilotToken = (githubAccessToken: string) =>
  _refreshCopilotToken(githubAccessToken, log);

export const refreshKiroToken = (refreshToken: string, providerSpecificData: any) =>
  _refreshKiroToken(refreshToken, providerSpecificData, log);

export const getAccessToken = (provider: string, credentials: any) =>
  _getAccessToken(provider, credentials, log);

export const refreshTokenByProvider = (provider: string, credentials: any) =>
  _refreshTokenByProvider(provider, credentials, log);

// ─── Lifecycle hook ───────────────────────────────────────────────────────────

/**
 * Call this when a connection is fully closed / removed.
 * Aborts any in-flight projectId fetch and evicts its cache entry,
 * preventing the module-level Maps from accumulating stale entries.
 */
export function releaseConnection(connectionId: string | null | undefined): void {
  if (!connectionId) return;
  removeConnection(connectionId);
  log.debug("TOKEN_REFRESH", "Released connection resources", { connectionId });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Compute an ISO expiry timestamp from a relative expiresIn (seconds).
 */
function toExpiresAt(expiresIn: number): string {
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

/**
 * Providers that carry a real Google project ID.
 */
function needsProjectId(provider: string): boolean {
  return provider === "antigravity" || provider === "gemini-cli";
}

/**
 * Non-blocking: fetch the project ID for a connection after a token refresh and
 * persist it to localDb.  Invalidates the stale cached value first so the fetch
 * always retrieves a fresh one.
 */
function _refreshProjectId(provider: string, connectionId: string, accessToken: string): void {
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
 */
export async function updateProviderCredentials(connectionId: string, newCredentials: any): Promise<boolean> {
  try {
    const updates: any = {};

    if (newCredentials.accessToken)         updates.accessToken  = newCredentials.accessToken;
    if (newCredentials.refreshToken)        updates.refreshToken = newCredentials.refreshToken;
    if (newCredentials.expiresIn) {
      updates.expiresAt = toExpiresAt(newCredentials.expiresIn);
      updates.expiresIn = newCredentials.expiresIn;
    }
    if (newCredentials.providerSpecificData) {
      updates.providerSpecificData = {
        ...(newCredentials.existingProviderSpecificData || {}),
        ...newCredentials.providerSpecificData,
      };
    }
    if (newCredentials.projectId)            updates.projectId = newCredentials.projectId;

    const result = await updateProviderConnection(connectionId, updates);
    log.info("TOKEN_REFRESH", "Credentials updated in localDb", {
      connectionId,
      success: !!result
    });
    return !!result;
  } catch (error: any) {
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
 */
export async function checkAndRefreshToken(provider: string, credentials: any): Promise<any> {
  let creds = { ...credentials };

  // ── 1. Regular access-token expiry ────────────────────────────────────────
  if (creds.expiresAt) {
    const expiresAt = new Date(creds.expiresAt).getTime();
    const now       = Date.now();
    const remaining = expiresAt - now;

    const refreshLead = _getRefreshLeadMs(provider);
    if (remaining < refreshLead) {
      log.info("TOKEN_REFRESH", "Token expiring soon, refreshing proactively", {
        provider,
        expiresIn: Math.round(remaining / 1000),
        refreshLeadMs: refreshLead,
      });

      const newCreds = await getAccessToken(provider, creds);
      if (newCreds?.accessToken) {
        const mergedCreds = {
          ...newCreds,
          existingProviderSpecificData: creds.providerSpecificData,
        };

        // Persist to DB (non-blocking path continues below)
        await updateProviderCredentials(creds.connectionId, mergedCreds);

        creds = {
          ...creds,
          accessToken:  newCreds.accessToken,
          refreshToken: newCreds.refreshToken ?? creds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData
            ? { ...creds.providerSpecificData, ...newCreds.providerSpecificData }
            : creds.providerSpecificData,
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
        creds.copilotToken = copilotToken.token;
      }
    }
  }

  return creds;
}

// ─── Local-specific: combined GitHub + Copilot refresh ───────────────────────

/**
 * Refresh the GitHub OAuth token and immediately exchange it for a fresh
 * Copilot token.
 */
export async function refreshGitHubAndCopilotTokens(credentials: any): Promise<any> {
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
