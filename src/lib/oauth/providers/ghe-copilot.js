import { PROVIDER_OAUTH } from "open-sse/providers/index.js";

const BASE = PROVIDER_OAUTH.github || {};

function root(value) {
  return String(value || "").replace(/\/+$/, "");
}

function requireGheUrl(options = {}) {
  const value =
    options.gheUrl ||
    options._gheUrl ||
    process.env.GHE_COPILOT_URL ||
    "";
  if (!value) {
    throw new Error("GHE Copilot requires gheUrl (or GHE_COPILOT_URL)");
  }
  return root(value);
}

const gheCopilot = {
  config: {
    ...BASE,
    clientId:
      process.env.GITHUB_OAUTH_CLIENT_ID ||
      BASE.clientId ||
      "Iv1.b507a08c87ecfe98",
    scopes: BASE.scopes || "read:user",
  },

  flowType: "device_code",

  requestDeviceCode: async (config, _codeChallenge, options = {}) => {
    const gheUrl = requireGheUrl(options);
    const clientId = options.clientId || config.clientId;

    const response = await fetch(`${gheUrl}/login/device/code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: clientId,
        scope: config.scopes || "read:user",
      }),
    });

    if (!response.ok) {
      throw new Error(`GHE device-code request failed: ${await response.text()}`);
    }

    return {
      ...(await response.json()),
      _gheUrl: gheUrl,
      _clientId: clientId,
    };
  },

  pollToken: async (config, deviceCode, _codeVerifier, extraData = {}) => {
    const gheUrl = requireGheUrl(extraData);
    const clientId = extraData._clientId || extraData.clientId || config.clientId;

    const response = await fetch(`${gheUrl}/login/oauth/access_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    let data;
    try {
      data = await response.json();
    } catch {
      data = { error: "invalid_response" };
    }

    if (data?.access_token) {
      data._gheUrl = gheUrl;
      data._clientId = clientId;
    }

    return { ok: response.ok, data };
  },

  postExchange: async (tokens) => {
    const gheUrl = requireGheUrl(tokens);
    const accessToken = tokens.access_token;

    const [copilotRes, userRes] = await Promise.all([
      fetch(`${gheUrl}/api/v3/copilot_internal/v2/token`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }),
      fetch(`${gheUrl}/api/v3/user`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }),
    ]);

    return {
      gheUrl,
      clientId: tokens._clientId,
      copilot: copilotRes.ok ? await copilotRes.json() : {},
      user: userRes.ok ? await userRes.json() : {},
    };
  },

  mapTokens: (tokens, extra) => ({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,

    copilotToken: extra?.copilot?.token,
    copilotTokenExpiresAt: extra?.copilot?.expires_at,

    name: extra?.user?.login || extra?.user?.name,
    displayName: extra?.user?.name || extra?.user?.login,
    email: extra?.user?.email || null,

    providerSpecificData: {
      gheUrl: extra?.gheUrl,
      clientId: extra?.clientId,
      copilotToken: extra?.copilot?.token,
      copilotTokenExpiresAt: extra?.copilot?.expires_at,
      ...(extra?.copilot?.endpoints?.api
        ? { copilotApiUrl: extra.copilot.endpoints.api }
        : {}),
      ...(extra?.copilot?.endpoints?.proxy
        ? { copilotProxyUrl: extra.copilot.endpoints.proxy }
        : {}),
      githubUserId: extra?.user?.id,
      githubLogin: extra?.user?.login,
    },
  }),
};

export default gheCopilot;
