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
        code: code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return await response.json();
  },
  postExchange: async (tokens) => {
    const loadHeaders = {
      "Authorization": `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json",
      "User-Agent": "antigravity",
      "x-request-source": "local",
    };
    const metadata = { ideType: "ANTIGRAVITY" };

    // Fetch user info
    const userInfoRes = await fetch(`${ANTIGRAVITY_CONFIG.userInfoUrl}?alt=json`, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "x-request-source": "local",
      },
    });
    const userInfo = userInfoRes.ok ? await userInfoRes.json() : {};

    // Invoke Cloud Code Assist control plane
    let projectId = "";
    try {
      const loadRes = await fetch("https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
        method: "POST",
        headers: loadHeaders,
        body: JSON.stringify({ metadata }),
      });

      if (loadRes.ok) {
        const data = await loadRes.json();
        if (Array.isArray(data.ineligibleTiers)) {
          for (const tier of data.ineligibleTiers) {
            if (tier.validationUrl) {
              console.warn(`[Antigravity] Account requires verification. Validation URL: ${tier.validationUrl}`);
            }
          }
        }

        if (typeof data.cloudaicompanionProject === "string") {
          projectId = data.cloudaicompanionProject.trim();
        } else if (data.cloudaicompanionProject && typeof data.cloudaicompanionProject === "object" && data.cloudaicompanionProject.id) {
          projectId = data.cloudaicompanionProject.id.trim();
        }

        // If response does not contain currentTier, onboard user to free-tier
        if (!data.currentTier) {
          try {
            const onboardRes = await fetch("https://daily-cloudcode-pa.googleapis.com/v1internal:onboardUser", {
              method: "POST",
              headers: loadHeaders,
              body: JSON.stringify({ tierId: "free-tier", metadata }),
            });

            if (onboardRes.ok) {
              const onboardData = await onboardRes.json();
              if (onboardData.done !== true && onboardData.name) {
                const opName = onboardData.name;
                const opPath = opName.startsWith("v1internal/")
                  ? opName.slice("v1internal/".length)
                  : (opName.startsWith("/") ? opName.slice(1) : opName);
                const opUrl = `https://daily-cloudcode-pa.googleapis.com/v1internal/${opPath}`;
                const startTime = Date.now();
                while (Date.now() - startTime < 30000) {
                  await new Promise(r => setTimeout(r, 1000));
                  try {
                    const pollRes = await fetch(opUrl, { headers: loadHeaders });
                    if (pollRes.ok) {
                      const pollData = await pollRes.json();
                      if (pollData.done === true) break;
                    }
                  } catch (_) {
                    // continue polling on transient network failure
                  }
                }
              }

              // Re-fetch loadCodeAssist to acquire provisioned cloudaicompanionProject
              const refetchRes = await fetch("https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
                method: "POST",
                headers: loadHeaders,
                body: JSON.stringify({ metadata }),
              });
              if (refetchRes.ok) {
                const refetchData = await refetchRes.json();
                if (typeof refetchData.cloudaicompanionProject === "string") {
                  projectId = refetchData.cloudaicompanionProject.trim();
                } else if (refetchData.cloudaicompanionProject && typeof refetchData.cloudaicompanionProject === "object" && refetchData.cloudaicompanionProject.id) {
                  projectId = refetchData.cloudaicompanionProject.id.trim();
                }
              }
            }
          } catch (onboardError) {
            console.error("[Antigravity] Onboarding error:", onboardError);
          }
        }
      }
    } catch (e) {
      console.error("[Antigravity] Failed to load code assist:", e);
    }

    return { userInfo, projectId };
  },
  mapTokens: (tokens, extra) => ({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    scope: tokens.scope,
    email: extra?.userInfo?.email,
    projectId: extra?.projectId,
  }),
};

export default antigravity;
