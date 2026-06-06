import { PROVIDERS } from "../config/providers.js";
import { OAUTH_ENDPOINTS, GITHUB_COPILOT } from "../config/appConstants.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { dedupRefresh } from "./refresh-dedup.js";

// xAI refresh — wraps the class method from src/lib/oauth/services/xai.js so
// the token-refresh switches below can stay flat (one function per provider).
let _xaiServiceSingleton = null;
export async function refreshXaiToken(refreshToken, log) {
  if (!refreshToken) return null;
  return dedupRefresh(
    "xai",
    refreshToken,
    async () => {
      try {
        if (!_xaiServiceSingleton) {
          const mod = await import("../../src/lib/oauth/services/xai.js");
          _xaiServiceSingleton = new mod.XaiService();
        }
        const tokens =
          await _xaiServiceSingleton.refreshAccessToken(refreshToken);
        return {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || refreshToken,
          expiresIn: tokens.expires_in,
          idToken: tokens.id_token,
        };
      } catch (e) {
        log?.warn?.("TOKEN_REFRESH", `xai refresh failed: ${e?.message || e}`);
        const msg = String(e?.message || "");
        if (msg.includes("invalid_grant") || msg.includes("invalid_request")) {
          return { error: "invalid_grant" };
        }
        return null;
      }
    },
    log,
  );
}

/**
 * Refresh OAuth access token using refresh token
 */
export async function refreshAccessToken(
  provider,
  refreshToken,
  credentials,
  log,
) {
  const config = PROVIDERS[provider];

  if (!config || !config.refreshUrl) {
    log?.warn?.(
      "TOKEN_REFRESH",
      `No refresh URL configured for provider: ${provider}`,
    );
    return null;
  }

  if (!refreshToken) {
    log?.warn?.(
      "TOKEN_REFRESH",
      `No refresh token available for provider: ${provider}`,
    );
    return null;
  }

  return dedupRefresh(
    provider,
    refreshToken,
    async () => {
      try {
        const response = await fetch(config.refreshUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: config.clientId,
            client_secret: config.clientSecret,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          log?.error?.(
            "TOKEN_REFRESH",
            `Failed to refresh token for ${provider}`,
            {
              status: response.status,
              error: errorText,
            },
          );
          return null;
        }

        const tokens = await response.json();

        log?.info?.(
          "TOKEN_REFRESH",
          `Successfully refreshed token for ${provider}`,
          {
            hasNewAccessToken: !!tokens.access_token,
            hasNewRefreshToken: !!tokens.refresh_token,
            expiresIn: tokens.expires_in,
          },
        );

        return {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || refreshToken,
          expiresIn: tokens.expires_in,
        };
      } catch (error) {
        log?.error?.(
          "TOKEN_REFRESH",
          `Error refreshing token for ${provider}`,
          {
            error: error.message,
          },
        );
        return null;
      }
    },
    log,
  );
}

/**
 * Specialized refresh for Claude OAuth tokens
 */
export async function refreshClaudeOAuthToken(refreshToken, log) {
  if (!refreshToken) return null;
  return dedupRefresh(
    "claude",
    refreshToken,
    async () => {
      try {
        const response = await fetch(OAUTH_ENDPOINTS.anthropic.token, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: PROVIDERS.claude.clientId,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          log?.error?.(
            "TOKEN_REFRESH",
            "Failed to refresh Claude OAuth token",
            { status: response.status, error: errorText },
          );
          return null;
        }

        const tokens = await response.json();
        log?.info?.(
          "TOKEN_REFRESH",
          "Successfully refreshed Claude OAuth token",
          {
            hasNewAccessToken: !!tokens.access_token,
            expiresIn: tokens.expires_in,
          },
        );
        return {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || refreshToken,
          expiresIn: tokens.expires_in,
        };
      } catch (error) {
        log?.error?.(
          "TOKEN_REFRESH",
          `Network error refreshing Claude token: ${error.message}`,
        );
        return null;
      }
    },
    log,
  );
}

/**
 * Specialized refresh for Google providers (Gemini, Antigravity)
 */
export async function refreshGoogleToken(
  refreshToken,
  clientId,
  clientSecret,
  log,
) {
  if (!refreshToken) return null;
  return dedupRefresh(
    `google:${clientId}`,
    refreshToken,
    async () => {
      try {
        const response = await fetch(OAUTH_ENDPOINTS.google.token, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          log?.error?.("TOKEN_REFRESH", "Failed to refresh Google token", {
            status: response.status,
            error: errorText,
          });
          return null;
        }

        const tokens = await response.json();
        log?.info?.("TOKEN_REFRESH", "Successfully refreshed Google token", {
          hasNewAccessToken: !!tokens.access_token,
          expiresIn: tokens.expires_in,
        });
        return {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || refreshToken,
          expiresIn: tokens.expires_in,
        };
      } catch (error) {
        log?.error?.(
          "TOKEN_REFRESH",
          `Network error refreshing Google token: ${error.message}`,
        );
        return null;
      }
    },
    log,
  );
}

/**
 * Specialized refresh for Qwen OAuth tokens
 */
export async function refreshQwenToken(refreshToken, log) {
  if (!refreshToken) return null;
  return dedupRefresh(
    "qwen",
    refreshToken,
    async () => {
      const endpoint = OAUTH_ENDPOINTS.qwen.token;

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: PROVIDERS.qwen.clientId,
          }),
        });

        if (response.status === 200) {
          const tokens = await response.json();

          log?.info?.("TOKEN_REFRESH", "Successfully refreshed Qwen token", {
            hasNewAccessToken: !!tokens.access_token,
            hasNewRefreshToken: !!tokens.refresh_token,
            expiresIn: tokens.expires_in,
          });

          return {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token || refreshToken,
            expiresIn: tokens.expires_in,
            providerSpecificData: tokens.resource_url
              ? { resourceUrl: tokens.resource_url }
              : undefined,
          };
        } else {
          const errorText = await response.text().catch(() => "");
          log?.warn?.("TOKEN_REFRESH", `Error with Qwen endpoint`, {
            status: response.status,
            error: errorText,
          });
        }
      } catch (error) {
        log?.warn?.("TOKEN_REFRESH", `Network error trying Qwen endpoint`, {
          error: error.message,
        });
      }

      log?.error?.("TOKEN_REFRESH", "Failed to refresh Qwen token");
      return null;
    },
    log,
  );
}

/**
 * Specialized refresh for Codex (OpenAI) OAuth tokens.
 * OpenAI uses rotating (one-time-use) refresh tokens.
 * Returns { error: 'unrecoverable_refresh_error' } when token already consumed/invalid,
 * so callers stop retrying and request re-authentication.
 */
export async function refreshCodexToken(refreshToken, log) {
  if (!refreshToken) return null;
  return dedupRefresh(
    "codex",
    refreshToken,
    async () => {
      try {
        const response = await fetch(OAUTH_ENDPOINTS.openai.token, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: PROVIDERS.codex.clientId,
            scope: "openid profile email offline_access",
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();

          // Detect unrecoverable errors (token reused/expired) — Auth0 revokes whole family on retry
          let errorCode = null;
          try {
            const parsed = JSON.parse(errorText);
            errorCode =
              parsed?.error?.code ||
              (typeof parsed?.error === "string" ? parsed.error : null);
          } catch {}

          if (
            errorCode === "refresh_token_reused" ||
            errorCode === "invalid_grant" ||
            errorCode === "token_expired" ||
            errorCode === "invalid_token"
          ) {
            log?.error?.(
              "TOKEN_REFRESH",
              "Codex refresh token already used or invalid. Re-auth required.",
              {
                status: response.status,
                errorCode,
              },
            );
            return { error: "unrecoverable_refresh_error", code: errorCode };
          }

          log?.error?.("TOKEN_REFRESH", "Failed to refresh Codex token", {
            status: response.status,
            error: errorText,
          });
          return null;
        }

        const tokens = await response.json();

        log?.info?.("TOKEN_REFRESH", "Successfully refreshed Codex token", {
          hasNewAccessToken: !!tokens.access_token,
          hasNewRefreshToken: !!tokens.refresh_token,
          expiresIn: tokens.expires_in,
        });

        return {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || refreshToken,
          expiresIn: tokens.expires_in,
        };
      } catch (error) {
        log?.error?.(
          "TOKEN_REFRESH",
          `Network error refreshing Codex token: ${error.message}`,
        );
        return null;
      }
    },
    log,
  );
}

/**
 * Specialized refresh for Kiro (AWS CodeWhisperer) tokens
 * Supports both AWS SSO OIDC (Builder ID/IDC) and Social Auth (Google/GitHub)
 */
export async function refreshKiroToken(
  refreshToken,
  providerSpecificData,
  log,
  proxyOptions = null,
  force = false,
) {
  if (!refreshToken) return null;
  return dedupRefresh(
    "kiro",
    refreshToken,
    async () => {
      const authMethod = providerSpecificData?.authMethod;
      const clientId = providerSpecificData?.clientId;
      const clientSecret = providerSpecificData?.clientSecret;
      const region = providerSpecificData?.region;

      // AWS SSO OIDC (Builder ID or IDC)
      // If clientId and clientSecret exist, assume AWS SSO OIDC (default to builder-id if authMethod not specified)
      if (clientId && clientSecret) {
        const isIDC = authMethod === "idc";
        const endpoint =
          isIDC && region
            ? `https://oidc.${region}.amazonaws.com/token`
            : "https://oidc.us-east-1.amazonaws.com/token";

        const response = await proxyAwareFetch(
          endpoint,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              clientId: clientId,
              clientSecret: clientSecret,
              refreshToken: refreshToken,
              grantType: "refresh_token",
            }),
          },
          proxyOptions,
        );

        if (!response.ok) {
          const errorText = await response.text();
          log?.error?.("TOKEN_REFRESH", "Failed to refresh Kiro AWS token", {
            status: response.status,
            error: errorText,
          });
          return null;
        }

        const tokens = await response.json();

        log?.info?.("TOKEN_REFRESH", "Successfully refreshed Kiro AWS token", {
          hasNewAccessToken: !!tokens.accessToken,
          expiresIn: tokens.expiresIn,
        });

        return {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken || refreshToken,
          expiresIn: tokens.expiresIn,
        };
      }

      // Social Auth (Google/GitHub) - use Kiro's refresh endpoint
      const response = await proxyAwareFetch(
        PROVIDERS.kiro.tokenUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "kiro-cli/1.0.0",
          },
          body: JSON.stringify({
            refreshToken: refreshToken,
          }),
        },
        proxyOptions,
      );

      if (!response.ok) {
        const errorText = await response.text();
        log?.error?.("TOKEN_REFRESH", "Failed to refresh Kiro social token", {
          status: response.status,
          error: errorText,
        });
        return null;
      }

      const tokens = await response.json();

      log?.info?.("TOKEN_REFRESH", "Successfully refreshed Kiro social token", {
        hasNewAccessToken: !!tokens.accessToken,
        expiresIn: tokens.expiresIn,
      });

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || refreshToken,
        expiresIn: tokens.expiresIn,
      };
    },
    log,
    force,
  );
}

/**
 * Specialized refresh for iFlow OAuth tokens
 */
export async function refreshIflowToken(refreshToken, log) {
  if (!refreshToken) return null;
  return dedupRefresh(
    "iflow",
    refreshToken,
    async () => {
      const basicAuth = btoa(
        `${PROVIDERS.iflow.clientId}:${PROVIDERS.iflow.clientSecret}`,
      );

      const response = await fetch(OAUTH_ENDPOINTS.iflow.token, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          Authorization: `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: PROVIDERS.iflow.clientId,
          client_secret: PROVIDERS.iflow.clientSecret,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log?.error?.("TOKEN_REFRESH", "Failed to refresh iFlow token", {
          status: response.status,
          error: errorText,
        });
        return null;
      }

      const tokens = await response.json();

      log?.info?.("TOKEN_REFRESH", "Successfully refreshed iFlow token", {
        hasNewAccessToken: !!tokens.access_token,
        hasNewRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expires_in,
      });

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || refreshToken,
        expiresIn: tokens.expires_in,
      };
    },
    log,
  );
}

/**
 * Specialized refresh for GitHub Copilot OAuth tokens
 */
export async function refreshGitHubToken(refreshToken, log) {
  if (!refreshToken) return null;
  return dedupRefresh(
    "github",
    refreshToken,
    async () => {
      const params = {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: PROVIDERS.github.clientId,
      };
      if (PROVIDERS.github.clientSecret) {
        params.client_secret = PROVIDERS.github.clientSecret;
      }

      const response = await fetch(OAUTH_ENDPOINTS.github.token, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams(params),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log?.error?.("TOKEN_REFRESH", "Failed to refresh GitHub token", {
          status: response.status,
          error: errorText,
        });
        return null;
      }

      const tokens = await response.json();

      log?.info?.("TOKEN_REFRESH", "Successfully refreshed GitHub token", {
        hasNewAccessToken: !!tokens.access_token,
        hasNewRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expires_in,
      });

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || refreshToken,
        expiresIn: tokens.expires_in,
      };
    },
    log,
  );
}

/**
 * Refresh GitHub Copilot token using GitHub access token
 */
export async function refreshCopilotToken(githubAccessToken, log) {
  if (!githubAccessToken) return null;
  return dedupRefresh(
    "copilot",
    githubAccessToken,
    async () => {
      try {
        const response = await fetch(
          "https://api.github.com/copilot_internal/v2/token",
          {
            headers: {
              Authorization: `token ${githubAccessToken}`,
              "User-Agent": GITHUB_COPILOT.USER_AGENT,
              "Editor-Version": `vscode/${GITHUB_COPILOT.VSCODE_VERSION}`,
              "Editor-Plugin-Version": `copilot-chat/${GITHUB_COPILOT.COPILOT_CHAT_VERSION}`,
              Accept: "application/json",
              "x-github-api-version": GITHUB_COPILOT.API_VERSION,
            },
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          log?.error?.("TOKEN_REFRESH", "Failed to refresh Copilot token", {
            status: response.status,
            error: errorText,
          });
          return null;
        }

        const data = await response.json();

        log?.info?.("TOKEN_REFRESH", "Successfully refreshed Copilot token", {
          hasToken: !!data.token,
          expiresAt: data.expires_at,
        });

        return {
          token: data.token,
          expiresAt: data.expires_at,
        };
      } catch (error) {
        log?.error?.("TOKEN_REFRESH", "Error refreshing Copilot token", {
          error: error.message,
        });
        return null;
      }
    },
    log,
  );
}
