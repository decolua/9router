import { CODEX_CONFIG } from "../constants/oauth.js";
import { extractCodexAccountInfo, extractEmailFromAccessToken } from "../providerHelpers.js";

const codex = {
  config: CODEX_CONFIG,
  flowType: "authorization_code_pkce",
  fixedPort: CODEX_CONFIG.fixedPort,
  callbackPath: CODEX_CONFIG.callbackPath,
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

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return await response.json();
  },
  mapTokens: (tokens) => {
    const info = extractCodexAccountInfo(tokens.id_token);
    const mapped = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
      expiresIn: tokens.expires_in,
      lastRefreshAt: new Date().toISOString(),
    };
    const email = info.email || extractEmailFromAccessToken(tokens.access_token);
    if (email) mapped.email = email;
    if (info.chatgptAccountId || info.chatgptPlanType) {
      mapped.providerSpecificData = {
        chatgptAccountId: info.chatgptAccountId,
        chatgptPlanType: info.chatgptPlanType,
      };
    }
    return mapped;
  },
};

export default codex;
