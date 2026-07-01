import crypto from "crypto";
import { PROVIDERS, PROVIDER_OAUTH } from "../../config/providers.js";
import { OAUTH_ENDPOINTS, GITHUB_COPILOT } from "../../config/appConstants.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { dedupRefresh } from "./dedup.js";
import { buildExternalIdpRefreshParams } from "../../../src/lib/oauth/kiroExternalIdp.js";

let _xaiServiceSingleton = null;
export async function refreshXaiToken(refreshToken, log) {
  if (!refreshToken) return null;
  return dedupRefresh(
    "xai",
    refreshToken,
    async () => {
      try {
        if (!_xaiServiceSingleton) {
          const mod = await import("../../../src/lib/oauth/services/xai.js");
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

export function classifyOAuthRefreshError(errorText = "", status = 0) {
  let parsed = null;
  try {
    parsed = errorText ? JSON.parse(errorText) : null;
  } catch {
    parsed = null;
  }

  const code = parsed?.error?.code || parsed?.error || parsed?.error_code || "";
  const description =
    parsed?.error_description || parsed?.message || errorText || "";
  const combined = `${code} ${description}`.toLowerCase();
  const permanent = [
    "refresh_token_expired",
    "refresh_token_reused",
    "refresh_token_invalidated",
    "invalid_grant",
  ].some((marker) => combined.includes(marker));

  return { status, code, description, permanent };
}

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
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            client_id: PROVIDERS.codex.clientId,
            grant_type: "refresh_token",
            refresh_token: refreshToken,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          const failure = classifyOAuthRefreshError(errorText, response.status);
          if (failure.permanent) {
            log?.error?.(
              "TOKEN_REFRESH",
              "Codex refresh token already used or invalid. Re-auth required.",
              {
                status: response.status,
                code: failure.code,
              },
            );
            return { error: "unrecoverable_refresh_error", code: failure.code };
          }

          log?.error?.("TOKEN_REFRESH", "Failed to refresh Codex token", {
            status: response.status,
            error: errorText,
            code: failure.code,
            permanent: failure.permanent,
          });
          return null;
        }

        const tokens = await response.json();

        log?.info?.("TOKEN_REFRESH", "Successfully refreshed Codex token", {
          hasNewAccessToken: !!tokens.access_token,
          hasNewRefreshToken: !!tokens.refresh_token,
          hasIdToken: !!tokens.id_token,
          expiresIn: tokens.expires_in,
        });

        return {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || refreshToken,
          idToken: tokens.id_token,
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

async function resolveKiroProfileArnPatch(
  providerSpecificData,
  accessToken,
  refreshedArn,
) {
  if (providerSpecificData?.profileArn) return {};
  let profileArn = refreshedArn?.trim?.() || null;
  if (!profileArn) {
    const { fetchKiroProfileArn } =
      await import("../../../src/lib/oauth/providers.js");
    profileArn = await fetchKiroProfileArn(accessToken);
  }
  return profileArn ? { providerSpecificData: { profileArn } } : {};
}

export async function refreshKiroToken(
  refreshToken,
  providerSpecificData,
  log,
  proxyOptions = null,
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

      if (authMethod === "external_idp") {
        let refreshRequest;
        try {
          refreshRequest = buildExternalIdpRefreshParams(
            refreshToken,
            providerSpecificData,
          );
        } catch (error) {
          log?.warn?.(
            "TOKEN_REFRESH",
            `Invalid Kiro external_idp refresh config: ${error.message}`,
          );
          return null;
        }

        const response = await proxyAwareFetch(
          refreshRequest.tokenEndpoint,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
            body: refreshRequest.body,
          },
          proxyOptions,
        );

        if (!response.ok) {
          const errorText = await response.text();
          log?.error?.(
            "TOKEN_REFRESH",
            "Failed to refresh Kiro external_idp token",
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
          "Successfully refreshed Kiro external_idp token",
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
          providerSpecificData: refreshRequest.providerSpecificData,
        };
      }

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
          ...(await resolveKiroProfileArnPatch(
            providerSpecificData,
            tokens.accessToken,
            tokens.profileArn,
          )),
        };
      }

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
        ...(await resolveKiroProfileArnPatch(
          providerSpecificData,
          tokens.accessToken,
          tokens.profileArn,
        )),
      };
    },
    log,
  );
}

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

export async function refreshCopilotToken(githubAccessToken, log) {
  if (!githubAccessToken) return null;
  return dedupRefresh(
    "copilot",
    githubAccessToken,
    async () => {
      try {
        const response = await fetch(
          PROVIDER_OAUTH["github"]?.copilotTokenUrl,
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

// CodeBuddy (Tencent) refresh — POST /v2/plugin/auth/token/refresh with the
// refresh token carried in the X-Refresh-Token header (not a form body),
// matching the official CodeBuddy CLI. Response: { code: 0, data: <token> }.
export async function refreshCodebuddyToken(refreshToken, log) {
  if (!refreshToken) return null;
  return dedupRefresh(
    "codebuddy-cn",
    refreshToken,
    async () => {
      const oauth = PROVIDER_OAUTH["codebuddy-cn"] || {};
      const response = await fetch(oauth.refreshUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": oauth.userAgent,
          "X-Requested-With": "XMLHttpRequest",
          "X-Domain": "copilot.tencent.com",
          "X-Refresh-Token": refreshToken,
          "X-Auth-Refresh-Source": "plugin",
          "X-Product": "SaaS",
        },
        body: "{}",
      });

      if (!response.ok) {
        const errorText = await response.text();
        log?.error?.("TOKEN_REFRESH", "Failed to refresh CodeBuddy token", {
          status: response.status,
          error: errorText,
        });
        return null;
      }

      const data = await response.json();
      if (data.code !== 0 || !data.data?.accessToken) {
        log?.error?.(
          "TOKEN_REFRESH",
          "CodeBuddy token refresh returned no token",
          {
            code: data.code,
            msg: data.msg,
          },
        );
        return null;
      }

      log?.info?.("TOKEN_REFRESH", "Successfully refreshed CodeBuddy token", {
        hasNewAccessToken: !!data.data.accessToken,
        hasNewRefreshToken: !!data.data.refreshToken,
        expiresIn: data.data.expiresIn,
      });

      return {
        accessToken: data.data.accessToken,
        refreshToken: data.data.refreshToken || refreshToken,
        expiresIn: data.data.expiresIn,
      };
    },
    log,
  );
}

/**
 * AutoClaw token refresh.
 *
 * Uses the app-signing header contract (X-Auth-Appid / X-Auth-TimeStamp / X-Auth-Sign
 * = md5(`${APP_ID}&${ts}&${APP_KEY}`)) and POSTs { source_id, device_id, refresh_token }
 * to /userapi/v1/refresh. The response is a { code, msg, data } envelope where data
 * holds { access_token, refresh_token }. access_token is a JWT (TTL 24h) whose payload
 * carries the authoritative device_id used for subsequent refreshes.
 *
 * source_id is stored at login time (providerSpecificData.sourceId) and defaults to
 * "autoclaw" — the spec notes an underspecified variant ("autoclawaccess_token") but
 * the verified working value for /refresh is "autoclaw".
 */
export async function refreshAutoClawToken(
  refreshToken,
  providerSpecificData,
  log,
  proxyOptions = null,
) {
  if (!refreshToken) return null;
  return dedupRefresh(
    "autoclaw",
    refreshToken,
    async () => {
      const oauth = PROVIDER_OAUTH["autoclaw"] || {};
      const appId = oauth.appId || "100003";
      const appKey = oauth.appKey || "38d2391985e2369a5fb8227d8e6cd5e5";
      const refreshUrl =
        oauth.refreshUrl || "https://autoglm-api.autoglm.ai/userapi/v1/refresh";
      const sourceId =
        providerSpecificData?.sourceId || oauth.sourceId || "autoclaw";
      const deviceId = providerSpecificData?.deviceId;

      if (!deviceId) {
        log?.error?.(
          "TOKEN_REFRESH",
          "AutoClaw refresh requires deviceId in providerSpecificData",
        );
        return null;
      }

      const ts = String(Math.floor(Date.now() / 1000));
      const sign = crypto
        .createHash("md5")
        .update(`${appId}&${ts}&${appKey}`)
        .digest("hex");
      const headers = {
        "X-Auth-Appid": appId,
        "X-Auth-TimeStamp": ts,
        "X-Auth-Sign": sign,
        "X-Product": "autoclaw",
        "X-Version": "1.9.1",
        "X-Tm": "win",
        "X-Trace-Id": crypto.randomUUID(),
        "Content-Type": "application/json",
      };

      const response = await proxyAwareFetch(
        refreshUrl,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            source_id: sourceId,
            device_id: deviceId,
            refresh_token: refreshToken,
          }),
        },
        proxyOptions,
      );

      if (!response.ok) {
        const errorText = await response.text();
        log?.error?.("TOKEN_REFRESH", "Failed to refresh AutoClaw token", {
          status: response.status,
          error: errorText,
        });
        return null;
      }

      const resp = await response.json();
      // { code, msg, data } envelope — code 0 / null means success.
      if (resp.code != null && resp.code !== 0) {
        log?.error?.("TOKEN_REFRESH", "AutoClaw refresh API error", {
          code: resp.code,
          msg: resp.msg,
        });
        return null;
      }
      const data = resp.data || {};
      let at = data.access_token || "";
      let rt = data.refresh_token || refreshToken;
      if (at.startsWith("Bearer ")) at = at.slice(7);
      if (rt.startsWith("Bearer ")) rt = rt.slice(7);
      if (!at) {
        log?.error?.(
          "TOKEN_REFRESH",
          "AutoClaw refresh response missing access_token",
          { data },
        );
        return null;
      }

      // Decode JWT exp (no verification) for refresh-lead scheduling.
      const exp = decodeJwtExp(at);
      log?.info?.("TOKEN_REFRESH", "Successfully refreshed AutoClaw token", {
        hasNewAccessToken: !!at,
        hasNewRefreshToken: rt !== refreshToken,
        exp: exp ? new Date(exp * 1000).toISOString() : null,
      });

      return {
        accessToken: at,
        refreshToken: rt,
        expiresIn: exp
          ? Math.max(1, exp - Math.floor(Date.now() / 1000))
          : 86400,
        providerSpecificData: { sourceId, deviceId },
      };
    },
    log,
  );
}

/** Decode JWT payload exp (no verification). Returns seconds since epoch or null. */
function decodeJwtExp(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(
      Buffer.from(
        payload + "=".repeat(-payload.length % 4),
        "base64url",
      ).toString("utf8"),
    );
    return typeof json.exp === "number" ? json.exp : null;
  } catch {
    return null;
  }
}
