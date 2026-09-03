import { GROK_CLI_CONFIG } from "../constants/oauth.js";
import { decodeXaiIdTokenEmail, extractEmailFromAccessToken } from "../providerHelpers.js";

// Grok CLI / Grok Build — device code flow to auth.x.ai, inference on cli-chat-proxy.grok.com
const grokCli = {
  config: GROK_CLI_CONFIG,
  flowType: "device_code",
  requestDeviceCode: async (config, _redirectUri, _meta, proxyOptions) => {
    const body = new URLSearchParams({
      client_id: config.clientId,
      scope: config.scope,
    });
    // Official CLI sends referrer=grok-build
    if (config.referrer) body.set("referrer", config.referrer);

    const response = await fetch(config.deviceCodeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
      },
      body,
      proxyOptions,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Grok CLI device code request failed: ${error}`);
    }

    return await response.json();
  },
  pollToken: async (config, deviceCode, _codeVerifier, _extra, proxyOptions) => {
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: config.clientId,
      }),
      proxyOptions,
    });

    let data;
    try {
      data = await response.json();
    } catch {
      const text = await response.text();
      data = { error: "invalid_response", error_description: text };
    }

    // Device flow: 400 + authorization_pending is expected while user authorizes
    const pending =
      data?.error === "authorization_pending" ||
      data?.error === "slow_down";
    return {
      ok: response.ok || pending,
      data,
    };
  },
  postExchange: async (tokens, proxyOptions) => {
    // Best-effort user profile from cli-chat-proxy (non-fatal)
    try {
      const res = await fetch("https://cli-chat-proxy.grok.com/v1/user", {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: "application/json",
          "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
          "x-xai-token-auth": "xai-grok-cli",
          "x-grok-client-version": "0.2.93",
        },
        proxyOptions,
      });
      if (res.ok) return { user: await res.json() };
    } catch {
      /* ignore */
    }
    return { user: null };
  },
  mapTokens: (tokens, extra) => {
    const email =
      decodeXaiIdTokenEmail(tokens.id_token) ||
      extractEmailFromAccessToken(tokens.access_token) ||
      extra?.user?.email ||
      null;
    const userId =
      extra?.user?.userId ||
      extra?.user?.principalId ||
      null;
    const displayName = [extra?.user?.firstName, extra?.user?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() || null;

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || null,
      expiresIn: tokens.expires_in,
      // Surface an absolute expiry so the proactive refresh path
      // (shouldRefreshCredentials / checkAndRefreshToken) can refresh the
      // xAI token before it silently expires ~40-45 min after login.
      // Without this, only the reactive 401 path in chatCore would refresh,
      // causing intermittent "token expired" failures for Grok CLI.
      expiresAt,
      scope: tokens.scope,
      // Top-level for dashboard connection cards
      email: email || undefined,
      displayName: displayName || undefined,
      // Mirror identity into providerSpecificData so GrokCliExecutor can set
      // x-email / x-userid without depending on top-level credential shape.
      providerSpecificData: {
        authMethod: "device_code",
        idToken: tokens.id_token || null,
        email: email || null,
        userId,
        hasGrokCodeAccess: extra?.user?.hasGrokCodeAccess ?? null,
        subscriptionTier: extra?.user?.subscriptionTier ?? null,
      },
    };
  },
};

export default grokCli;
