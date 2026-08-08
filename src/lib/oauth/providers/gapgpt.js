import { GAPGPT_CONFIG } from "../constants/oauth.js";

export default {
  config: GAPGPT_CONFIG,
  flowType: "authorization_code_pkce",
  fixedPort: GAPGPT_CONFIG.fixedPort,
  callbackPath: GAPGPT_CONFIG.callbackPath,
  buildAuthUrl: (config, redirectUri, state, codeChallenge) => {
    const params = {
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: config.scope,
      code_challenge: codeChallenge,
      code_challenge_method: config.codeChallengeMethod,
      ...config.extraParams,
      state: state,
    };
    const queryString = Object.entries(params)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join("&");
    return `${config.authorizeUrl}?${queryString}`;
  },
  exchangeToken: async (config, code, redirectUri, codeVerifier) => {
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        code: code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Token exchange failed: ${raw}`);
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`Token exchange returned non-JSON body: ${raw.slice(0, 200)}`);
    }
  },
  mapTokens: (tokens) => {
    const t = tokens && typeof tokens.data === "object" && tokens.data ? tokens.data : tokens;
    const key = t.api_key || t.apiKey || t.access_token;
    const mapped = {
      accessToken: key,
      apiKey: key,
      lastRefreshAt: new Date().toISOString(),
    };
    if (t.refresh_token) mapped.refreshToken = t.refresh_token;
    if (t.expires_in) mapped.expiresIn = t.expires_in;
    return mapped;
  },
};
