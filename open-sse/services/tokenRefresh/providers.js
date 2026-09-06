import { PROVIDERS, PROVIDER_OAUTH } from "../../config/providers.js";
import { OAUTH_ENDPOINTS, GITHUB_COPILOT, buildKimiHeaders } from "../../config/appConstants.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { dedupRefresh } from "./dedup.js";
import { buildExternalIdpRefreshParams } from "../../../src/lib/oauth/kiroExternalIdp.js";

let _xaiServiceSingleton = null;
export async function refreshXaiToken(refreshToken, log) {
  if (!refreshToken) return null;
  return dedupRefresh("xai", refreshToken, async () => {
    try {
      if (!_xaiServiceSingleton) {
        const mod = await import("../../../src/lib/oauth/services/xai.js");
        _xaiServiceSingleton = new mod.XaiService();
      }
      const tokens = await _xaiServiceSingleton.refreshAccessToken(refreshToken);
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
  }, log);
}

// Per-provider refresh variants for the generic path. Keys not listed fall back
// to the default form-encoded OAuth2 refresh with client_id + client_secret.
const REFRESH_PROFILES = {
  claude: {
    bodyFormat: "json",
    includeClientSecret: false,
    url: () => OAUTH_ENDPOINTS.anthropic.token,
    dedupKey: "claude",
  },
  iflow: {
    url: () => OAUTH_ENDPOINTS.iflow.token,
    dedupKey: "iflow",
    extraHeaders: (creds, cfg) => ({
      Authorization: `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}`,
    }),
  },
  github: {
    url: () => OAUTH_ENDPOINTS.github.token,
    dedupKey: "github",
    includeClientSecret: (cfg) => !!cfg?.clientSecret,
  },
  kimi: {
    dedupKey: "kimi",
    extraHeaders: (creds) => buildKimiHeaders(creds?.providerSpecificData?.deviceId),
  },
};

function resolveRefreshUrl(provider, config, profile) {
  if (profile?.url) {
    try { return profile.url(); } catch { /* fall through */ }
  }
  return config?.refreshUrl || PROVIDER_OAUTH[provider]?.tokenUrl || null;
}

function buildRefreshBody(profile, config, refreshToken) {
  const fmt = profile?.bodyFormat === "json" ? "json" : "form";
  const includeSecret = profile?.includeClientSecret === undefined
    ? true
    : typeof profile.includeClientSecret === "function"
      ? profile.includeClientSecret(config)
      : profile.includeClientSecret;
  const payload = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
  };
  if (includeSecret && config.clientSecret) payload.client_secret = config.clientSecret;
  if (fmt === "json") return { format: "json", body: JSON.stringify(payload) };
  return { format: "form", body: new URLSearchParams(payload) };
}

export async function refreshAccessToken(provider, refreshToken, credentials, log) {
  const config = PROVIDERS[provider];
  const profile = REFRESH_PROFILES[provider] || {};
  const url = resolveRefreshUrl(provider, config, profile);

  if (!config || !url) {
    log?.warn?.("TOKEN_REFRESH", `No refresh URL configured for provider: ${provider}`);
    return null;
  }

  if (!refreshToken) {
    log?.warn?.("TOKEN_REFRESH", `No refresh token available for provider: ${provider}`);
    return null;
  }

  const dedupKey = profile.dedupKey || provider;

  return dedupRefresh(dedupKey, refreshToken, async () => {
  try {
    const { format: bodyFormat, body } = buildRefreshBody(profile, config, refreshToken);
    const headers = {
      "Content-Type": bodyFormat === "json" ? "application/json" : "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...(profile.extraHeaders ? (profile.extraHeaders(credentials, config) || {}) : {}),
    };
    const response = await fetch(url, { method: "POST", headers, body });

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", `Failed to refresh token for ${provider}`, {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    const tokens = await response.json();

    log?.info?.("TOKEN_REFRESH", `Successfully refreshed token for ${provider}`, {
      hasNewAccessToken: !!tokens.access_token,
      hasNewRefreshToken: !!tokens.refresh_token,
      expiresIn: tokens.expires_in,
    });

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || refreshToken,
      expiresIn: tokens.expires_in,
      ...(profile.parse ? (profile.parse(tokens) || {}) : {}),
    };
  } catch (error) {
    log?.error?.("TOKEN_REFRESH", `Error refreshing token for ${provider}`, {
      error: error.message,
    });
    return null;
  }
  }, log);
}

// CLIProxyAPI DeviceFlowClient.RefreshToken: form body (no client_secret) + X-Msh-* headers
// Delegate to refreshAccessToken("kimi", ...) — profile carries the X-Msh headers.
export async function refreshKimiToken(refreshToken, credentials, log) {
  return refreshAccessToken("kimi", refreshToken, credentials, log);
}

export async function refreshClineToken(refreshToken, log) {
  if (!refreshToken) return null;

  return dedupRefresh("cline", refreshToken, async () => {
    try {
      const response = await fetch(PROVIDERS.cline?.refreshUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          refreshToken,
          grantType: "refresh_token",
          clientType: "extension",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log?.error?.("TOKEN_REFRESH", "Failed to refresh Cline token", {
          status: response.status,
          error: errorText,
        });
        return null;
      }

      const body = await response.json();
      const tokens = body?.data || body;
      if (!tokens?.accessToken) return null;

      const expiresIn = tokens.expiresAt
        ? Math.max(1, Math.floor((new Date(tokens.expiresAt).getTime() - Date.now()) / 1000))
        : (tokens.expiresIn || tokens.expires_in || 3600);

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || refreshToken,
        expiresIn,
      };
    } catch (error) {
      log?.error?.("TOKEN_REFRESH", `Error refreshing Cline token: ${error.message}`);
      return null;
    }
  }, log);
}

// Claude OAuth: JSON body, client_id only. Delegate to refreshAccessToken("claude", ...).
export async function refreshClaudeOAuthToken(refreshToken, log) {
  return refreshAccessToken("claude", refreshToken, {}, log);
}

export async function refreshGoogleToken(refreshToken, clientId, clientSecret, log) {
  if (!refreshToken) return null;
  return dedupRefresh(`google:${clientId}`, refreshToken, async () => {
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
      log?.error?.("TOKEN_REFRESH", "Failed to refresh Google token", { status: response.status, error: errorText });
      return null;
    }

    const tokens = await response.json();
    log?.info?.("TOKEN_REFRESH", "Successfully refreshed Google token", { hasNewAccessToken: !!tokens.access_token, expiresIn: tokens.expires_in });
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
  } catch (error) {
    log?.error?.("TOKEN_REFRESH", `Network error refreshing Google token: ${error.message}`);
    return null;
  }
  }, log);
}

export function classifyOAuthRefreshError(errorText = "", status = 0) {
  let parsed = null;
  try {
    parsed = errorText ? JSON.parse(errorText) : null;
  } catch {
    parsed = null;
  }

  const code = parsed?.error?.code || parsed?.error || parsed?.error_code || "";
  const description = parsed?.error_description || parsed?.message || errorText || "";
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
  return dedupRefresh("codex", refreshToken, async () => {
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
          log?.error?.("TOKEN_REFRESH", "Codex refresh token already used or invalid. Re-auth required.", {
            status: response.status,
            code: failure.code,
          });
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
      log?.error?.("TOKEN_REFRESH", `Network error refreshing Codex token: ${error.message}`);
      return null;
    }
  }, log);
}

async function resolveKiroProfileArnPatch(providerSpecificData, accessToken, refreshedArn) {
  if (providerSpecificData?.profileArn) return {};
  let profileArn = refreshedArn?.trim?.() || null;
  if (!profileArn) {
    const { fetchKiroProfileArn } = await import("../../../src/lib/oauth/providers.js");
    profileArn = await fetchKiroProfileArn(accessToken);
  }
  return profileArn ? { providerSpecificData: { profileArn } } : {};
}

export async function refreshKiroToken(refreshToken, providerSpecificData, log, proxyOptions = null) {
  if (!refreshToken) return null;
  return dedupRefresh("kiro", refreshToken, async () => {
  const authMethod = providerSpecificData?.authMethod;
  const clientId = providerSpecificData?.clientId;
  const clientSecret = providerSpecificData?.clientSecret;
  const region = providerSpecificData?.region;

  if (authMethod === "external_idp") {
    let refreshRequest;
    try {
      refreshRequest = buildExternalIdpRefreshParams(refreshToken, providerSpecificData);
    } catch (error) {
      log?.warn?.("TOKEN_REFRESH", `Invalid Kiro external_idp refresh config: ${error.message}`);
      return null;
    }

    const response = await proxyAwareFetch(refreshRequest.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: refreshRequest.body,
    }, proxyOptions);

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh Kiro external_idp token", {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    const tokens = await response.json();

    log?.info?.("TOKEN_REFRESH", "Successfully refreshed Kiro external_idp token", {
      hasNewAccessToken: !!tokens.access_token,
      hasNewRefreshToken: !!tokens.refresh_token,
      expiresIn: tokens.expires_in,
    });

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || refreshToken,
      expiresIn: tokens.expires_in,
      providerSpecificData: refreshRequest.providerSpecificData,
    };
  }

  if (clientId && clientSecret) {
    const isIDC = authMethod === "idc";
    const endpoint = isIDC && region
      ? `https://oidc.${region}.amazonaws.com/token`
      : "https://oidc.us-east-1.amazonaws.com/token";

    const response = await proxyAwareFetch(endpoint, {
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
    }, proxyOptions);

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
      ...(await resolveKiroProfileArnPatch(providerSpecificData, tokens.accessToken, tokens.profileArn)),
    };
  }

  const response = await proxyAwareFetch(PROVIDERS.kiro.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "kiro-cli/1.0.0",
    },
    body: JSON.stringify({
      refreshToken: refreshToken,
    }),
  }, proxyOptions);

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
    ...(await resolveKiroProfileArnPatch(providerSpecificData, tokens.accessToken, tokens.profileArn)),
  };
  }, log);
}

// iFlow: Basic Auth + client_id+client_secret in body. Delegate to refreshAccessToken("iflow", ...).
export async function refreshIflowToken(refreshToken, log) {
  return refreshAccessToken("iflow", refreshToken, {}, log);
}

// GitHub: optional client_secret. Delegate to refreshAccessToken("github", ...).
export async function refreshGitHubToken(refreshToken, log) {
  return refreshAccessToken("github", refreshToken, {}, log);
}

export async function refreshCopilotToken(githubAccessToken, log) {
  if (!githubAccessToken) return null;
  return dedupRefresh("copilot", githubAccessToken, async () => {
  try {
    const response = await fetch(PROVIDER_OAUTH["github"]?.copilotTokenUrl, {
      headers: {
        "Authorization": `token ${githubAccessToken}`,
        "User-Agent": GITHUB_COPILOT.USER_AGENT,
        "Editor-Version": `vscode/${GITHUB_COPILOT.VSCODE_VERSION}`,
        "Editor-Plugin-Version": `copilot-chat/${GITHUB_COPILOT.COPILOT_CHAT_VERSION}`,
        "Accept": "application/json",
        "x-github-api-version": GITHUB_COPILOT.API_VERSION
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh Copilot token", {
        status: response.status,
        error: errorText
      });
      return null;
    }

    const data = await response.json();

    log?.info?.("TOKEN_REFRESH", "Successfully refreshed Copilot token", {
      hasToken: !!data.token,
      expiresAt: data.expires_at
    });

    return {
      token: data.token,
      expiresAt: data.expires_at
    };
  } catch (error) {
    log?.error?.("TOKEN_REFRESH", "Error refreshing Copilot token", {
      error: error.message
    });
    return null;
  }
  }, log);
}

// CodeBuddy (Tencent) refresh — POST /v2/plugin/auth/token/refresh with the
// refresh token carried in the X-Refresh-Token header (not a form body),
// matching the official CodeBuddy CLI. Response: { code: 0, data: <token> }.
export async function refreshCodebuddyToken(refreshToken, log) {
  if (!refreshToken) return null;
  return dedupRefresh("codebuddy-cn", refreshToken, async () => {
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
      log?.error?.("TOKEN_REFRESH", "CodeBuddy token refresh returned no token", {
        code: data.code,
        msg: data.msg,
      });
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
  }, log);
}

export async function refreshCodebuddyIntlToken(refreshToken, log) {
  if (!refreshToken) return null;
  return dedupRefresh("codebuddy-intl", refreshToken, async () => {
    const oauth = PROVIDER_OAUTH["codebuddy-intl"] || {};
    const response = await fetch(oauth.refreshUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": oauth.userAgent,
        "X-Requested-With": "XMLHttpRequest",
        "X-Domain": "www.codebuddy.ai",
        "X-Refresh-Token": refreshToken,
        "X-Auth-Refresh-Source": "plugin",
        "X-Product": "SaaS",
      },
      body: "{}",
    });

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh CodeBuddy intl token", {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    const data = await response.json();
    if (data.code !== 0 || !data.data?.accessToken) {
      log?.error?.("TOKEN_REFRESH", "CodeBuddy intl token refresh returned no token", {
        code: data.code,
        msg: data.msg,
      });
      return null;
    }

    log?.info?.("TOKEN_REFRESH", "Successfully refreshed CodeBuddy intl token", {
      hasNewAccessToken: !!data.data.accessToken,
      hasNewRefreshToken: !!data.data.refreshToken,
      expiresIn: data.data.expiresIn,
    });

    return {
      accessToken: data.data.accessToken,
      refreshToken: data.data.refreshToken || refreshToken,
      expiresIn: data.data.expiresIn,
    };
  }, log);
}

// Trae refresh — POST ExchangeToken with JSON body {ClientID, RefreshToken, ClientSecret, UserID}.
// Response: {Result: {AccessToken, RefreshToken, TokenType, ExpiresAt}}.
export async function refreshTraeToken(refreshToken, credentials, log) {
  if (!refreshToken) return null;
  const oauth = PROVIDER_OAUTH.trae || {};
  const url = oauth.exchangeTokenUrl || oauth.tokenUrl;
  if (!url) {
    log?.warn?.("TOKEN_REFRESH", "No Trae exchangeTokenUrl configured");
    return null;
  }

  return dedupRefresh("trae", refreshToken, async () => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "Trae/1.0.0 antigravity-cockpit-tools",
        },
        body: JSON.stringify({
          ClientID: oauth.clientId || "ono9krqynydwx5",
          RefreshToken: refreshToken,
          ClientSecret: oauth.clientSecret || "-",
          UserID: "",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log?.error?.("TOKEN_REFRESH", "Failed to refresh Trae token", {
          status: response.status,
          error: errorText,
        });
        return null;
      }

      const payload = await response.json();
      const result = payload?.Result || payload?.result || payload;
      const accessToken = result?.AccessToken || result?.accessToken;
      if (!accessToken) {
        log?.error?.("TOKEN_REFRESH", "Trae refresh returned no AccessToken", { payload });
        return null;
      }

      const newRefresh = result?.RefreshToken || result?.refreshToken || refreshToken;
      const expiresAt = result?.ExpiresAt || result?.expiresAt;
      let expiresIn;
      if (typeof expiresAt === "number") {
        expiresIn = Math.max(1, expiresAt - Math.floor(Date.now() / 1000));
      } else if (typeof expiresAt === "string") {
        const ms = new Date(expiresAt).getTime() - Date.now();
        expiresIn = ms > 0 ? Math.floor(ms / 1000) : undefined;
      }

      log?.info?.("TOKEN_REFRESH", "Successfully refreshed Trae token", {
        hasNewAccessToken: !!accessToken,
        hasNewRefreshToken: newRefresh !== refreshToken,
        expiresIn,
      });

      return {
        accessToken,
        refreshToken: newRefresh,
        expiresIn,
      };
    } catch (error) {
      log?.error?.("TOKEN_REFRESH", `Error refreshing Trae token: ${error.message}`);
      return null;
    }
  }, log);
}

// Zed access_token is long-lived; auth flow returns no refresh_token.
// No refresh possible — re-login required when token expires/revoked.
// Mirrors cursor/kilocode null-refresh pattern.
export function refreshZedToken() {
  return null;
}

// Nous Portal (Hermes CLI): refresh token rides in the X-Nous-Refresh-Token
// header, not the request body — body is just grant_type + client_id.
export async function refreshNousPortalToken(refreshToken, log) {
  if (!refreshToken) return null;
  const oauth = PROVIDER_OAUTH["nous-portal"] || {};
  const url = oauth.refreshUrl || oauth.tokenUrl;
  if (!url || !oauth.clientId) {
    log?.warn?.("TOKEN_REFRESH", "No Nous Portal refresh URL configured");
    return null;
  }

  return dedupRefresh("nous-portal", refreshToken, async () => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "X-Nous-Refresh-Token": refreshToken,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: oauth.clientId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log?.error?.("TOKEN_REFRESH", "Failed to refresh Nous Portal token", {
          status: response.status,
          error: errorText,
        });
        return null;
      }

      const tokens = await response.json();
      log?.info?.("TOKEN_REFRESH", "Successfully refreshed Nous Portal token", {
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
      log?.error?.("TOKEN_REFRESH", `Error refreshing Nous Portal token: ${error.message}`);
      return null;
    }
  }, log);
}

// Windsurf apiKey is the long-lived terminal credential (no OAuth2 refresh_token
// grant yields a fresh apiKey). Refresh handled out-of-band by the caller.
// TODO(firebase): if short-lived Firebase JWT credentials must be refreshed,
// re-run RegisterUser with the refreshed Firebase JWT (separate code path).
export async function refreshWindsurfToken(credentials, log) {
  log?.info?.(
    "TOKEN_REFRESH",
    "windsurf: apiKey is long-lived (no refresh_token flow) — skipping"
  );
  return null;
}
