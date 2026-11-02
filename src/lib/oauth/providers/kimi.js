import crypto from "crypto";
import { KIMI_CONFIG } from "../constants/oauth.js";

// Kimi Code device flow (CLIProxyAPI internal/auth/kimi). Id is `kimi`;
// `kimi-coding` remains an alias key so old UI/API routes still resolve.
const kimi = {
  config: KIMI_CONFIG,
  flowType: "device_code",
  requestDeviceCode: async (config) => {
    const { buildKimiHeaders } = await import("open-sse/config/appConstants.js");
    const deviceId = crypto.randomUUID();
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...buildKimiHeaders(deviceId),
    };
    const response = await fetch(config.deviceCodeUrl, {
      method: "POST",
      headers,
      body: new URLSearchParams({ client_id: config.clientId }),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Device code request failed: ${error}`);
    }
    const data = await response.json();
    const authorizeDeviceUrl = config.authorizeDeviceUrl || "https://www.kimi.com/code/authorize_device";
    return {
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri || authorizeDeviceUrl,
      verification_uri_complete:
        data.verification_uri_complete ||
        `${authorizeDeviceUrl}?user_code=${data.user_code}`,
      expires_in: data.expires_in,
      interval: data.interval || 5,
      _kimiDeviceId: deviceId,
    };
  },
  pollToken: async (config, deviceCode, _codeVerifier, extraData) => {
    const { buildKimiHeaders } = await import("open-sse/config/appConstants.js");
    const deviceId = extraData?._kimiDeviceId;
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...buildKimiHeaders(deviceId),
    };
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers,
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
    // CLIProxyAPI: Kimi returns 200 for pending states with error field
    if (data.error === "authorization_pending" || data.error === "slow_down") {
      return { ok: true, data };
    }
    if (data.access_token && deviceId) data._kimiDeviceId = deviceId;
    return { ok: response.ok || !!data.access_token || !!data.error, data };
  },
  mapTokens: (tokens) => ({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    providerSpecificData: {
      authMethod: "device_code",
      ...(tokens._kimiDeviceId ? { deviceId: tokens._kimiDeviceId } : {}),
    },
  }),
};

export default kimi;
