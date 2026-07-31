import { IFLOW_CONFIG } from "../constants/oauth.js";

const iflow = {
  config: IFLOW_CONFIG,
  flowType: "authorization_code",
  buildAuthUrl: (config, redirectUri, state) => {
    const params = new URLSearchParams({
      loginMethod: config.extraParams.loginMethod,
      type: config.extraParams.type,
      redirect: redirectUri,
      state: state,
      client_id: config.clientId,
    });
    return `${config.authorizeUrl}?${params.toString()}`;
  },
  exchangeToken: async (config, code, redirectUri) => {
    // Create Basic Auth header
    const basicAuth = Buffer.from(
      `${config.clientId}:${config.clientSecret}`
    ).toString("base64");

    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return await response.json();
  },
  postExchange: async (tokens) => {
    // Fetch user info (MUST succeed to get API key)
    const userInfoRes = await fetch(
      `${IFLOW_CONFIG.userInfoUrl}?accessToken=${encodeURIComponent(tokens.access_token)}`,
      {
        headers: {
          Accept: "application/json",
        },
      }
    );

    if (!userInfoRes.ok) {
      const errorText = await userInfoRes.text();
      throw new Error(`Failed to fetch user info: ${errorText}`);
    }

    const result = await userInfoRes.json();
    if (!result.success) {
      throw new Error(`User info request failed: ${result.message || 'Unknown error'}`);
    }

    const userInfo = result.data || {};

    // Validate API key (critical for iFlow)
    if (!userInfo.apiKey || userInfo.apiKey.trim() === "") {
      throw new Error("Empty API key returned from iFlow");
    }

    // Validate email/phone
    const email = userInfo.email?.trim() || userInfo.phone?.trim();
    if (!email) {
      throw new Error("Missing account email/phone in user info");
    }

    return { userInfo };
  },
  mapTokens: (tokens, extra) => ({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    apiKey: extra?.userInfo?.apiKey,
    email: extra?.userInfo?.email || extra?.userInfo?.phone,
    displayName: extra?.userInfo?.nickname || extra?.userInfo?.name,
  }),
};

export default iflow;
