import { FACTORY_CONFIG } from "../constants/oauth.js";

const WORKOS_CLIENT_ID = "client_01HNM792M5G5G1A2THWPXKFMXB";
const WORKOS_DEVICE_AUTHORIZE = "https://api.workos.com/user_management/authorize/device";
const WORKOS_TOKEN = "https://api.workos.com/user_management/authenticate";
const FACTORY_API = "https://api.factory.ai";

function parseJwtPayload(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  try {
    const [, b64] = token.split(".");
    const base64 = b64.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function resolveOrgIdFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  return (
    payload.org_id ||
    payload.organization_id ||
    payload.organizationId ||
    payload.orgId ||
    payload.external_org_id ||
    null
  );
}

const factory = {
  config: FACTORY_CONFIG,
  flowType: "device_code",

  requestDeviceCode: async (config) => {
    const clientId = config?.clientId || WORKOS_CLIENT_ID;
    const url = config?.deviceCodeUrl || WORKOS_DEVICE_AUTHORIZE;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: clientId,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Factory device authorization request failed: ${error}`);
    }

    const data = await response.json();
    return {
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: "https://auth.factory.ai/device",
      verification_uri_complete: data.verification_uri_complete || "https://auth.factory.ai/device",
      expires_in: data.expires_in || 300,
      interval: data.interval || 5,
    };
  },

  pollToken: async (config, deviceCode) => {
    const clientId = config?.clientId || WORKOS_CLIENT_ID;
    const tokenUrl = config?.tokenUrl || WORKOS_TOKEN;

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    let data;
    try {
      data = await response.json();
    } catch {
      const text = await response.text();
      data = { error: "invalid_response", error_description: text };
    }

    return {
      ok: response.ok,
      data,
    };
  },

  postExchange: async (tokens) => {
    const accessToken = tokens.access_token;
    let whoami = null;
    let apiEndpoint = FACTORY_API;
    let orgId = null;
    let region = null;

    // Decode JWT payload first as fallback
    const jwtPayload = parseJwtPayload(accessToken);
    orgId = resolveOrgIdFromPayload(jwtPayload);

    // Query /api/cli/whoami to get authoritative user identity, active org, and region
    try {
      const res = await fetch(`${FACTORY_API}/api/cli/whoami`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Factory-Client": "cli",
          "X-Client-Version": "0.213.0",
          "User-Agent": "factory-cli/0.213.0",
        },
      });
      if (res.ok) {
        whoami = await res.json();
        if (whoami.org_id || whoami.orgId || whoami.current_org?.id) {
          orgId = whoami.org_id || whoami.orgId || whoami.current_org?.id;
        }
        if (whoami.region) {
          region = whoami.region;
          if (region === "eu" || region === "europe") {
            apiEndpoint = "https://api.eu.factory.ai";
          } else if (region !== "global" && /^[a-z0-9-]+$/i.test(region)) {
            apiEndpoint = `https://api.${region.toLowerCase()}.factory.ai`;
          }
        }
      }
    } catch {
      // Non-critical: network timeout, fall back to JWT claims
    }

    return { whoami, orgId, region, apiEndpoint, jwtPayload };
  },

  mapTokens: (tokens, extra) => {
    const email =
      tokens.user?.email ||
      extra?.whoami?.user?.email ||
      extra?.whoami?.email ||
      extra?.jwtPayload?.email ||
      null;

    const displayName =
      tokens.user?.name ||
      extra?.whoami?.user?.name ||
      extra?.whoami?.name ||
      email ||
      "Factory User";

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      name: displayName,
      displayName,
      email,
      providerSpecificData: {
        orgId: extra?.orgId || null,
        region: extra?.region || null,
        apiEndpoint: extra?.apiEndpoint || FACTORY_API,
      },
    };
  },
};

export default factory;
