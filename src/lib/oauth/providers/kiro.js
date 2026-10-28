import { KIRO_CONFIG, assertValidAwsRegion } from "../constants/oauth.js";
import { extractEmailFromAccessToken } from "../providerHelpers.js";

const kiro = {
  config: KIRO_CONFIG,
  flowType: "device_code",
  // Kiro uses AWS SSO OIDC - requires client registration first
  requestDeviceCode: async (config, codeChallenge, options = {}) => {
    const trimmedRegion = typeof options.region === "string" ? options.region.trim() : "";
    const region = trimmedRegion || "us-east-1";
    assertValidAwsRegion(region);
    const trimmedStartUrl = typeof options.startUrl === "string" ? options.startUrl.trim() : "";
    const startUrl = trimmedStartUrl || config.startUrl;
    const authMethod = options.authMethod === "idc" ? "idc" : "builder-id";
    const registerClientUrl = `https://oidc.${region}.amazonaws.com/client/register`;
    const deviceAuthUrl = `https://oidc.${region}.amazonaws.com/device_authorization`;

    // Step 1: Register client with AWS SSO OIDC
    const registerRes = await fetch(registerClientUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        clientName: config.clientName,
        clientType: config.clientType,
        scopes: config.scopes,
        grantTypes: config.grantTypes,
        issuerUrl: config.issuerUrl,
      }),
    });

    if (!registerRes.ok) {
      const error = await registerRes.text();
      throw new Error(`Client registration failed: ${error}`);
    }

    const clientInfo = await registerRes.json();

    // Step 2: Request device authorization
    const deviceRes = await fetch(deviceAuthUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        clientId: clientInfo.clientId,
        clientSecret: clientInfo.clientSecret,
        startUrl,
      }),
    });

    if (!deviceRes.ok) {
      const error = await deviceRes.text();
      throw new Error(`Device authorization failed: ${error}`);
    }

    const deviceData = await deviceRes.json();

    // Return combined data for polling
    return {
      device_code: deviceData.deviceCode,
      user_code: deviceData.userCode,
      verification_uri: deviceData.verificationUri,
      verification_uri_complete: deviceData.verificationUriComplete,
      expires_in: deviceData.expiresIn,
      interval: deviceData.interval || 5,
      // Store client credentials for token exchange
      _clientId: clientInfo.clientId,
      _clientSecret: clientInfo.clientSecret,
      _region: region,
      _authMethod: authMethod,
      _startUrl: startUrl,
    };
  },
  pollToken: async (config, deviceCode, codeVerifier, extraData) => {
    const region = extraData?._region || "us-east-1";
    assertValidAwsRegion(region);
    const tokenUrl = `https://oidc.${region}.amazonaws.com/token`;
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        clientId: extraData?._clientId,
        clientSecret: extraData?._clientSecret,
        deviceCode: deviceCode,
        grantType: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    let data;
    try {
      data = await response.json();
    } catch (e) {
      const text = await response.text();
      data = { error: "invalid_response", error_description: text };
    }

    // AWS SSO OIDC returns camelCase
    if (data.accessToken) {
      return {
        ok: true,
        data: {
          access_token: data.accessToken,
          refresh_token: data.refreshToken,
          expires_in: data.expiresIn,
          profile_arn: data?.profileArn || null,
          // Store client credentials for refresh
          _clientId: extraData?._clientId,
          _clientSecret: extraData?._clientSecret,
          _region: extraData?._region,
          _authMethod: extraData?._authMethod,
          _startUrl: extraData?._startUrl,
        },
      };
    }

    return {
      ok: false,
      data: {
        error: data.error || "authorization_pending",
        error_description: data.error_description || data.message,
      },
    };
  },
  mapTokens: (tokens) => {
    const email = extractEmailFromAccessToken(tokens.access_token);
    const mapped = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      email,
      providerSpecificData: {
        profileArn: tokens?.profile_arn || null,
        clientId: tokens._clientId,
        clientSecret: tokens._clientSecret,
        region: tokens._region || "us-east-1",
        authMethod: tokens._authMethod || "builder-id",
        startUrl: tokens._startUrl || KIRO_CONFIG.startUrl,
      },
    };
    return mapped;
  },
};

export default kiro;
