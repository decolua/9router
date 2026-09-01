const CONFIG = {
  clientId:
    process.env.OPENFERENCE_OAUTH_CLIENT_ID ||
    process.env.OPENFERENCE_CLIENT_ID ||
    "",

  authorizeUrl:
    "https://openference.com/app/oauth/authorize",

  tokenUrl:
    "https://openference.com/oauth/token",

  userinfoUrl:
    "https://openference.com/oauth/userinfo",

  scope:
    "openid profile email model:invoke offline_access",

  codeChallengeMethod: "S256",

  loopbackPort: 56123,
  callbackPath: "/callback",
  callbackHost: "127.0.0.1",
};

function decodeIdentity(idToken) {
  if (
    typeof idToken !== "string"
  ) {
    return {
      email: null,
      name: null,
    };
  }

  const parts =
    idToken.split(".");

  if (parts.length !== 3) {
    return {
      email: null,
      name: null,
    };
  }

  try {
    let base64 =
      parts[1]
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    while (
      base64.length % 4 !== 0
    ) {
      base64 += "=";
    }

    const payload =
      JSON.parse(
        Buffer
          .from(
            base64,
            "base64"
          )
          .toString("utf8")
      );

    return {
      email:
        payload.email ||
        payload.preferred_username ||
        null,

      name:
        payload.name ||
        null,
    };
  } catch {
    return {
      email: null,
      name: null,
    };
  }
}

const openference = {
  config: CONFIG,

  flowType:
    "authorization_code_pkce",

  fixedPort:
    CONFIG.loopbackPort,

  callbackPath:
    CONFIG.callbackPath,

  callbackHost:
    CONFIG.callbackHost,

  buildAuthUrl(
    config,
    redirectUri,
    state,
    codeChallenge
  ) {
    if (!config.clientId) {
      throw new Error(
        "Openference OAuth client ID is not configured. Set OPENFERENCE_OAUTH_CLIENT_ID."
      );
    }

    const params =
      new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: redirectUri,
        scope: config.scope,
        code_challenge:
          codeChallenge,
        code_challenge_method:
          config.codeChallengeMethod,
        state,
      });

    return (
      config.authorizeUrl +
      "?" +
      params.toString()
    );
  },

  async exchangeToken(
    config,
    code,
    redirectUri,
    codeVerifier
  ) {
    const response =
      await fetch(
        config.tokenUrl,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded",

            Accept:
              "application/json",
          },

          body:
            new URLSearchParams({
              grant_type:
                "authorization_code",

              client_id:
                config.clientId,

              code,
              redirect_uri:
                redirectUri,

              code_verifier:
                codeVerifier,
            }),
        }
      );

    if (!response.ok) {
      const text =
        await response.text();

      throw new Error(
        "Openference token exchange failed: " +
        text.slice(0, 500)
      );
    }

    return response.json();
  },

  async postExchange(tokens) {
    if (!tokens?.access_token) {
      return {
        userInfo: {},
      };
    }

    const response =
      await fetch(
        CONFIG.userinfoUrl,
        {
          headers: {
            Authorization:
              "Bearer " +
              tokens.access_token,

            Accept:
              "application/json",
          },
        }
      );

    return {
      userInfo:
        response.ok
          ? await response.json()
          : {},
    };
  },

  mapTokens(tokens, extra) {
    const identity =
      decodeIdentity(
        tokens?.id_token
      );

    const userInfo =
      extra?.userInfo || {};

    const email =
      identity.email ||
      userInfo.email ||
      userInfo.preferred_username ||
      null;

    const name =
      identity.name ||
      userInfo.name ||
      email ||
      null;

    return {
      accessToken:
        tokens.access_token,

      refreshToken:
        tokens.refresh_token,

      idToken:
        tokens.id_token,

      expiresIn:
        tokens.expires_in,

      email,
      name,

      providerSpecificData: {
        scope:
          tokens.scope ||
          CONFIG.scope,

        tokenType:
          tokens.token_type ||
          "Bearer",
      },
    };
  },
};

export default openference;
