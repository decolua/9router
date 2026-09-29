import { ANTIGRAVITY_CONFIG, getOAuthClientMetadata } from "../constants/oauth.js";

const antigravity = {
  config: ANTIGRAVITY_CONFIG,
  flowType: "authorization_code",
  buildAuthUrl: (config, redirectUri, state) => {
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: config.scopes.join(" "),
      state: state,
      access_type: "offline",
      prompt: "consent",
    });
    return `${config.authorizeUrl}?${params.toString()}`;
  },
  exchangeToken: async (config, code, redirectUri) => {
    const raw = typeof code === "string" ? code.trim() : "";
    let refreshToken = null;
    let accessToken = null;
    let customProjectId = null;

    if (raw.startsWith("{") && raw.endsWith("}")) {
      try {
        const parsed = JSON.parse(raw);
        refreshToken = parsed.refresh_token || parsed.refreshToken || null;
        accessToken = parsed.access_token || parsed.accessToken || null;
        customProjectId = parsed.project_id || parsed.projectId || null;
      } catch {}
    }

    if (!refreshToken && (raw.startsWith("1//") || raw.startsWith("1/"))) {
      refreshToken = raw;
    }

    if (!refreshToken && !accessToken && raw.startsWith("ya29.")) {
      accessToken = raw;
    }

    // Direct Refresh Token (Method 2: Paste Token)
    if (refreshToken) {
      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: config.clientId,
          client_secret: config.clientSecret,
          refresh_token: refreshToken,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token refresh failed: ${error}`);
      }

      const refreshed = await response.json();
      return {
        access_token: refreshed.access_token,
        refresh_token: refreshToken,
        expires_in: refreshed.expires_in || 3600,
        scope: refreshed.scope,
        token_type: refreshed.token_type || "Bearer",
        id_token: refreshed.id_token,
        ...(customProjectId ? { projectId: customProjectId } : {}),
      };
    }

    // Direct Access Token (Method 2: Paste Token)
    if (accessToken) {
      return {
        access_token: accessToken,
        refresh_token: null,
        expires_in: 3600,
        token_type: "Bearer",
        ...(customProjectId ? { projectId: customProjectId } : {}),
      };
    }

    // Authorization Code Flow (Method 1: Browser OAuth)
    let authCode = raw;
    if (authCode.startsWith("4%2F") || authCode.includes("%2F")) {
      try {
        authCode = decodeURIComponent(authCode);
      } catch {}
    }

    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: authCode,
        redirect_uri: redirectUri || "http://localhost:20128/callback",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const data = await response.json();
    if (customProjectId) {
      data.projectId = customProjectId;
    }
    return data;
  },
  postExchange: async (tokens) => {
    const loadHeaders = {
      "Authorization": `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json",
      "User-Agent": ANTIGRAVITY_CONFIG.loadCodeAssistUserAgent,
      "x-request-source": "local",
    };
    const metadata = getOAuthClientMetadata();

    // Extract email from id_token if available
    let userInfo = {};
    if (tokens.id_token) {
      try {
        const b64 = tokens.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
        userInfo = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
      } catch {}
    }

    // Fetch user info from Google if not resolved from id_token
    if (!userInfo.email) {
      try {
        const userInfoRes = await fetch(`${ANTIGRAVITY_CONFIG.userInfoUrl}?alt=json`, {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            "x-request-source": "local",
          },
        });
        if (userInfoRes.ok) {
          const fetched = await userInfoRes.json();
          userInfo = { ...fetched, ...userInfo };
        }
      } catch (e) {
        console.log("Failed to fetch user info:", e);
      }
    }

    // Load Code Assist to get project ID and tier
    let projectId = tokens.projectId || "";
    let tierId = "legacy-tier";
    try {
      const loadRes = await fetch(ANTIGRAVITY_CONFIG.loadCodeAssistEndpoint, {
        method: "POST",
        headers: loadHeaders,
        body: JSON.stringify({ metadata }),
      });
      if (loadRes.ok) {
        const data = await loadRes.json();
        const detected = data.cloudaicompanionProject?.id || data.cloudaicompanionProject || "";
        if (detected) projectId = detected;
        if (Array.isArray(data.allowedTiers)) {
          for (const tier of data.allowedTiers) {
            if (tier.isDefault && tier.id) {
              tierId = tier.id.trim();
              break;
            }
          }
        }
      }
    } catch (e) {
      console.log("Failed to load code assist:", e);
    }

    // Fire-and-forget onboarding — does not block DB save
    if (projectId) {
      const doOnboard = async () => {
        for (let i = 0; i < 10; i++) {
          try {
            const onboardRes = await fetch(ANTIGRAVITY_CONFIG.onboardUserEndpoint, {
              method: "POST",
              headers: loadHeaders,
              body: JSON.stringify({ tierId, metadata }),
            });
            if (onboardRes.ok) {
              const result = await onboardRes.json();
              if (result.done === true) break;
            }
          } catch (e) {
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      };
      doOnboard().catch(() => {});
    }

    return { userInfo, projectId };
  },
  mapTokens: (tokens, extra) => ({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    scope: tokens.scope,
    email: extra?.userInfo?.email || tokens.email || null,
    projectId: extra?.projectId || tokens.projectId || null,
  }),
};

export default antigravity;
