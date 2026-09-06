import { NOUS_PORTAL_CONFIG } from "../constants/oauth.js";

// Nous Portal device flow (Hermes CLI client, portal.nousresearch.com).
// Non-standard refresh: the refresh token rides in the X-Nous-Refresh-Token
// header instead of the body (see refreshNousPortalToken).
const nousPortal = {
  config: NOUS_PORTAL_CONFIG,
  flowType: "device_code",
  requestDeviceCode: async (config) => {
    const response = await fetch(config.deviceCodeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        scope: config.scope,
      }),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Device code request failed: ${error}`);
    }
    return await response.json();
  },
  pollToken: async (config, deviceCode) => {
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: config.clientId,
        device_code: deviceCode,
      }),
    });
    let data;
    try {
      data = await response.json();
    } catch {
      data = { error: "invalid_response", error_description: "non-json token response" };
    }
    return { ok: response.ok, data };
  },
  // Best-effort account info (email/name) for the connections list display.
  postExchange: async (tokens) => {
    try {
      const response = await fetch(NOUS_PORTAL_CONFIG.userInfoUrl, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: "application/json",
        },
      });
      if (!response.ok) return {};
      const account = await response.json();
      return { account };
    } catch {
      return {};
    }
  },
  mapTokens: (tokens, extra) => {
    // /account shape: { user: { email, privy_did }, organisation: { id, slug, name }, ... }
    const account = extra?.account || {};
    const email = account.user?.email || null;
    const orgName = account.organisation?.name || null;
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      name: orgName || email,
      displayName: orgName,
      email,
      providerSpecificData: {
        authMethod: "device_code",
        ...(account.user?.privy_did ? { nousUserId: account.user.privy_did } : {}),
        ...(account.organisation?.id ? { nousOrgId: account.organisation.id } : {}),
      },
    };
  },
};

export default nousPortal;
