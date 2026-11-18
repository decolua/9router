import crypto from "crypto";
import { GLM_OAUTH_CONFIG } from "../constants/oauth.js";

// Zai GLM Coding OAuth — CLI polling flow (mirrors the official
// ZCode CLI, apps/zcode-cli packages/adapters/src/auth/cli-oauth.ts +
// coding-plan-api-key.ts). No PKCE and no local callback server:
//
//   1) POST {cliInitUrl}   Authorization: Bearer <pollToken>  {"provider":"zai"}
//        → { code: 0, data: { authorize_url, flow_id, poll_interval_sec, expires_at } }
//   2) Browser opens authorize_url; user signs in with the Z.ai account
//   3) GET {cliPollUrl}/<flow_id>   Authorization: Bearer <pollToken>
//        → { data: { status: "pending" } } until
//          { data: { status: "ready", token, user, accessToken, refreshToken? } }
//   4) accessToken (Z.AI OAuth token) → POST {businessLoginUrl} {"token": ...}
//        → { data: { access_token } } (platform business JWT)
//   5) Business JWT → coding-plan API key via getCustomerInfo → api_keys
//      list/create("zcode-api-key") → copy → "apiKey.secretKey"
//
// The Coding Plan API keys and official ZCode JWT are model credentials for
// different plans. There is no refresh grant, so expiry means re-login.
const glm = {
  config: GLM_OAUTH_CONFIG,
  flowType: "device_code",
  requestDeviceCode: async (config) => {
    const pollToken = crypto.randomBytes(32).toString("hex");
    const response = await fetch(config.cliInitUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pollToken}`,
      },
      body: JSON.stringify({ provider: config.providerId || "zai" }),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ZCode OAuth init failed: ${error}`);
    }
    const payload = await response.json();
    if (!isSuccessCode(payload.code) || !payload.data) {
      throw new Error(payload.msg || "ZCode OAuth init returned no data");
    }
    const data = payload.data;
    if (!data.flow_id || !data.authorize_url) {
      throw new Error("ZCode OAuth init response missing flow_id/authorize_url");
    }
    return {
      device_code: data.flow_id,
      verification_uri: data.authorize_url,
      // expires_at is upstream-absolute; surface a relative deadline for the UI
      expires_in: relativeSeconds(data.expires_at) ?? 300,
      interval: data.poll_interval_sec || 3,
      _zcodePollToken: pollToken,
    };
  },
  pollToken: async (config, deviceCode, _codeVerifier, extraData) => {
    const pollToken = extraData?._zcodePollToken;
    if (!pollToken) {
      return {
        ok: true,
        data: {
          error: "access_denied",
          error_description: "Missing ZCode poll token — restart the login flow",
        },
      };
    }

    const response = await fetch(`${config.cliPollUrl}/${encodeURIComponent(deviceCode)}`, {
      headers: { Authorization: `Bearer ${pollToken}` },
    });
    if (!response.ok) {
      return {
        ok: true,
        data: {
          error: "access_denied",
          error_description: `ZCode poll failed (HTTP ${response.status})`,
        },
      };
    }

    const payload = await response.json();
    if (!isSuccessCode(payload.code)) {
      return {
        ok: true,
        data: { error: "access_denied", error_description: payload.msg || "ZCode poll failed" },
      };
    }

    const data = payload.data || {};
    if (data.status === "pending") {
      return { ok: true, data: { error: "authorization_pending" } };
    }
    if (data.status === "failed") {
      return {
        ok: true,
        data: {
          error: "access_denied",
          error_description: "ZCode authorization failed or was cancelled",
        },
      };
    }
    if (data.status !== "ready") {
      return {
        ok: true,
        data: { error: "authorization_pending", error_description: `Unknown status: ${data.status}` },
      };
    }

    // ready payload nests the ZAI OAuth tokens under data[providerId] (see
    // apps/zcode-cli cli-oauth.ts parseReadyData): { status:"ready", token,
    // user, zai: { access_token, refresh_token? } }. Fall back to top-level
    // fields for resilience against payload drift.
    const providerData = data[config.providerId] || data[data.providerId] || {};
    const zaiAccessToken =
      providerData.access_token ||
      providerData.accessToken ||
      data.accessToken ||
      data.access_token;
    if (!zaiAccessToken) {
      return {
        ok: true,
        data: {
          error: "access_denied",
          error_description: "ZCode poll response missing access token",
        },
      };
    }

    // Keep the official ZCode JWT for gateway plans, and best-effort provision
    // separate API keys for every Coding Plan project on the same account.
    const zcodeJwtToken = data.token || "";
    let individualPlanApiKey = null;
    let teamPlanApiKey = null;
    let businessToken = "";
    try {
      ({ individualPlanApiKey, teamPlanApiKey, businessToken } = await resolveCodingPlanApiKeys(config, zaiAccessToken));
    } catch (error) {
      if (!zcodeJwtToken) throw error;
    }
    const planApiKey = individualPlanApiKey || teamPlanApiKey || zcodeJwtToken;
    if (!planApiKey) {
      return {
        ok: true,
        data: {
          error: "access_denied",
          error_description: "No Z.ai Coding Plan or ZCode Start Plan is available for this account",
        },
      };
    }

    return {
      ok: true,
      data: {
        access_token: planApiKey,
        _zcodeJwtToken: zcodeJwtToken,
        _zaiBusinessToken: businessToken,
        _individualCodingPlanApiKey: individualPlanApiKey || "",
        _teamCodingPlanApiKey: teamPlanApiKey || "",
        _zaiRefreshToken:
          providerData.refresh_token || providerData.refreshToken || data.refresh_token || data.refreshToken || "",
        _zcodeUser: data.user || {},
      },
    };
  },
  mapTokens: (tokens) => {
    const user = tokens._zcodeUser || {};
    const displayName = user.name || user.email || null;
    return {
      accessToken: tokens.access_token,
      refreshToken: null,
      email: user.email || null,
      ...(displayName ? { displayName } : {}),
      providerSpecificData: {
        authMethod: "cli_poll",
        plan: tokens._individualCodingPlanApiKey
          ? "individual-coding-plan"
          : tokens._teamCodingPlanApiKey ? "team-coding-plan" : "start-plan",
        username: user.name || undefined,
        userId: user.user_id || undefined,
        zcodeJwtToken: tokens._zcodeJwtToken || undefined,
        zaiBusinessToken: tokens._zaiBusinessToken || undefined,
        individualCodingPlanApiKey: tokens._individualCodingPlanApiKey || undefined,
        teamCodingPlanApiKey: tokens._teamCodingPlanApiKey || undefined,
        ...(tokens._zaiRefreshToken ? { zaiRefreshToken: tokens._zaiRefreshToken } : {}),
      },
    };
  },
};

// Business JWT → coding-plan API key ("apiKey.secretKey"). Mirrors ZCode CLI
// coding-plan-api-key.ts: getCustomerInfo → default org/project → api_keys
// list/create("zcode-api-key") → copy → secretKey.
async function resolveCodingPlanApiKeys(config, zaiAccessToken) {
  const businessToken = await exchangeBusinessToken(config, zaiAccessToken);
  const authHeaders = {
    Authorization: `Bearer ${businessToken}`,
    "Content-Type": "application/json",
  };

  const customerInfo = await fetchBusinessJson(
    `${config.apiBaseUrl}/api/biz/customer/getCustomerInfo`,
    { headers: authHeaders },
    "customer info"
  );
  const locations = pickPlanProjects(customerInfo);
  const individualPlanApiKey = locations.individual
    ? await resolveProjectApiKey(config, authHeaders, locations.individual).catch(() => null)
    : null;
  const teamPlanApiKey = locations.team
    ? await resolveProjectApiKey(config, authHeaders, locations.team).catch(() => null)
    : null;

  return { individualPlanApiKey, teamPlanApiKey, businessToken };
}

async function resolveProjectApiKey(config, authHeaders, location) {
  const listUrl =
    `${config.apiBaseUrl}/api/biz/v1/organization/${location.organizationId}` +
    `/projects/${location.projectId}/api_keys`;
  const keys = (await fetchBusinessJson(listUrl, { headers: authHeaders }, "api keys")) || [];
  let keyEntry = Array.isArray(keys)
    ? keys.find((item) => item?.name === config.planApiKeyName)
    : null;
  if (!keyEntry) {
    keyEntry = await fetchBusinessJson(
      listUrl,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name: config.planApiKeyName }),
      },
      "api key create"
    );
  }

  const apiKey = keyEntry?.apiKey?.trim();
  if (!apiKey) {
    throw new Error("Z.ai api_keys response is missing apiKey");
  }

  const secret = await fetchBusinessJson(
    `${listUrl}/copy/${encodeURIComponent(apiKey)}`,
    { headers: authHeaders },
    "api key copy"
  );
  const secretKey = secret?.secretKey?.trim();
  if (!secretKey) {
    throw new Error("Z.ai api key copy response is missing secretKey");
  }

  return `${apiKey}.${secretKey}`;
}

// POST {businessLoginUrl} {"token": <zai oauth token>} → { data: { access_token } }
async function exchangeBusinessToken(config, zaiAccessToken) {
  const payload = await fetchBusinessJson(
    config.businessLoginUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: zaiAccessToken }),
    },
    "Z.ai business login"
  );
  const token = payload?.access_token?.trim() || payload?.accessToken?.trim();
  if (!token) {
    throw new Error("Z.ai business login response is missing access_token");
  }
  return token;
}

// Business endpoints answer {code, msg, data}; code 0/200 (or absent) = success.
// data is returned directly (null when missing).
async function fetchBusinessJson(url, options, label) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Z.ai ${label} request failed (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Z.ai ${label} response is not valid JSON`);
  }
  if (!isSuccessCode(payload?.code) || payload?.success === false) {
    throw new Error(payload?.msg || `Z.ai ${label} returned business error ${payload?.code}`);
  }
  return payload?.data ?? payload ?? null;
}

// ZCode identifies team projects with projectType "2". Keep one key per plan so
// switching plans never sends a personal key to a team entitlement (or vice versa).
function pickPlanProjects(customerInfo) {
  const organizations = Array.isArray(customerInfo?.organizations)
    ? customerInfo.organizations
    : [];
  const findLocation = (team) => {
    const candidates = organizations.flatMap((organization) =>
      (organization?.projects || [])
        .filter((project) => (String(project?.projectType ?? "").trim() === "2") === team)
        .filter((project) => organization?.organizationId && project?.projectId)
        .map((project) => ({ organization, project })),
    );
    const selected = candidates.find(({ organization, project }) =>
      isDefaultName(organization.organizationName) || isDefaultName(project.projectName),
    ) || candidates[0];
    return selected ? {
      organizationId: selected.organization.organizationId,
      projectId: selected.project.projectId,
    } : null;
  };
  return { individual: findLocation(false), team: findLocation(true) };
}

function isDefaultName(name) {
  const normalized = String(name || "").trim().toLowerCase();
  return normalized.includes("默认机构") || normalized.includes("默认项目") || normalized === "default";
}

function isSuccessCode(code) {
  return code === undefined || code === null || code === 0 || code === 200 || code === "0" || code === "200";
}

// Absolute epoch (s or ms) → seconds from now; null when absent/invalid.
function relativeSeconds(expiresAt) {
  const raw = Number(expiresAt);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const ms = raw > 1e12 ? raw : raw * 1000;
  const seconds = Math.floor((ms - Date.now()) / 1000);
  return seconds > 0 ? seconds : null;
}

export default glm;
