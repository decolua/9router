import { KIMCHI_CONFIG } from "../constants/oauth.js";

const kimchi = {
  config: KIMCHI_CONFIG,
  flowType: "browser_token",
  buildAuthUrl: (config, redirectUri, state) => {
    const baseUrl = (config.webAppUrl || "https://app.kimchi.dev").replace(/\/+$/, "");
    const params = new URLSearchParams({
      callback: redirectUri,
      state,
    });
    return `${baseUrl}/cli-auth?${params.toString()}`;
  },
  exchangeToken: async (config, token) => {
    const accessToken = String(token || "").trim();
    if (!accessToken) {
      throw new Error("Missing Kimchi token");
    }

    const validationUrl = config.validationUrl || "https://api.cast.ai/v1/llm/openai/supported-providers";
    const validationRes = await fetch(validationUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!validationRes.ok) {
      throw new Error(`Kimchi token validation failed: ${validationRes.status}`);
    }

    let userInfo = {};
    if (config.userInfoUrl) {
      try {
        const userRes = await fetch(config.userInfoUrl, {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (userRes.ok) {
          userInfo = await userRes.json();
        }
      } catch {
        userInfo = {};
      }
    }

    return {
      access_token: accessToken,
      token_type: "Bearer",
      _kimchiUser: userInfo,
    };
  },
  mapTokens: (tokens) => {
    const user = tokens._kimchiUser || {};
    const userId = user.id ? String(user.id) : "";
    const username = user.username || "";
    const email = user.email || (userId ? `kimchi-user-${userId}` : null);
    return {
      accessToken: tokens.access_token,
      refreshToken: null,
      email,
      displayName: user.name || username || null,
      providerSpecificData: {
        authMethod: "browser_token",
        userId,
        username,
      },
    };
  },
};

export default kimchi;
