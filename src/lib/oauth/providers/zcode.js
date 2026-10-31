import crypto from "crypto";
import { ZCODE_CONFIG } from "../constants/oauth.js";
import { resolveZcodeAuth } from "open-sse/services/zcodePlan.js";

// ZCode device login uses the official CLI polling flow (same endpoint as the
// `glm` provider). The web authorization-code flow is not usable here: the
// desktop client id only registers the zcode:// deep-link intermediary, so any
// dashboard callback is rejected with "Redirect URI not registered".
//
//   1) POST {cliInitUrl}  Authorization: Bearer <pollToken>  {"provider":"zai"}
//        → { data: { authorize_url, flow_id, poll_interval_sec, expires_at } }
//   2) Browser opens authorize_url; the user signs in.
//   3) GET {cliPollUrl}/<flow_id>  until status=ready
//        → { data: { status:"ready", token, user, zai: { access_token } } }
//   4) data.token            = zcode JWT (start-plan model key)
//      data.zai.access_token = Z.AI business token (coding-plan project key)
const TIMEOUT_MS = 20000;

function familyOf(meta, config) {
  if (meta?.family === "bigmodel") return "bigmodel";
  return config?.providerId === "bigmodel" ? "bigmodel" : "zai";
}

function isSuccessCode(code) {
  return code === undefined || code === null || code === 0 || code === 200 || code === "0" || code === "200";
}

function relativeSeconds(expiresAt) {
  const raw = Number(expiresAt);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const ms = raw > 1e12 ? raw : raw * 1000;
  const seconds = Math.floor((ms - Date.now()) / 1000);
  return seconds > 0 ? seconds : null;
}

async function readJson(response, label) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ZCode ${label} failed (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`ZCode ${label} response is not valid JSON`);
  }
}

const zcode = {
  config: ZCODE_CONFIG,
  flowType: "device_code",
  requestDeviceCode: async (config, _codeChallenge, options = {}) => {
    const family = familyOf(options, config);
    const pollToken = crypto.randomBytes(32).toString("hex");
    const payload = await readJson(
      await fetch(config.cliInitUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${pollToken}`,
        },
        body: JSON.stringify({ provider: family }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
      "OAuth init"
    );
    if (!isSuccessCode(payload?.code) || !payload?.data) {
      throw new Error(payload?.msg || "ZCode OAuth init returned no data");
    }
    const data = payload.data;
    if (!data.flow_id || !data.authorize_url) {
      throw new Error("ZCode OAuth init response missing flow_id/authorize_url");
    }
    return {
      device_code: data.flow_id,
      verification_uri: data.authorize_url,
      expires_in: relativeSeconds(data.expires_at) ?? 300,
      interval: data.poll_interval_sec || 3,
      _zcodePollToken: pollToken,
      _zcodeFamily: family,
    };
  },
  pollToken: async (config, deviceCode, _codeVerifier, extraData = {}) => {
    const pollToken = extraData?._zcodePollToken;
    const family = familyOf(extraData, config);
    if (!pollToken) {
      return {
        ok: true,
        data: {
          error: "access_denied",
          error_description: "Missing ZCode poll token — restart the login flow",
        },
      };
    }

    let payload;
    try {
      payload = await readJson(
        await fetch(`${config.cliPollUrl}/${encodeURIComponent(deviceCode)}`, {
          headers: { Authorization: `Bearer ${pollToken}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
        "OAuth poll"
      );
    } catch (error) {
      return { ok: true, data: { error: "access_denied", error_description: error.message } };
    }

    if (!isSuccessCode(payload?.code)) {
      return { ok: true, data: { error: "access_denied", error_description: payload?.msg || "ZCode poll failed" } };
    }

    const data = payload.data || {};
    if (data.status === "pending") {
      return { ok: true, data: { error: "authorization_pending" } };
    }
    if (data.status === "failed") {
      return {
        ok: true,
        data: { error: "access_denied", error_description: "ZCode authorization failed or was cancelled" },
      };
    }
    if (data.status !== "ready") {
      return { ok: true, data: { error: "authorization_pending", error_description: `Unknown status: ${data.status}` } };
    }

    const providerData = data[family] || data[config.providerId] || {};
    const accessToken =
      providerData.access_token || providerData.accessToken || data.accessToken || data.access_token;
    if (!accessToken) {
      return {
        ok: true,
        data: { error: "access_denied", error_description: "ZCode poll response missing access token" },
      };
    }

    return {
      ok: true,
      data: {
        access_token: accessToken,
        _zcodeJwtToken: data.token || "",
        _zcodeFamily: family,
        _zcodeRefreshToken:
          providerData.refresh_token || providerData.refreshToken || data.refresh_token || data.refreshToken || "",
        _zcodeUser: data.user || {},
      },
    };
  },
  postExchange: async (tokens) => {
    try {
      const plan = await resolveZcodeAuth({
        accessToken: tokens.access_token,
        providerSpecificData: {
          family: tokens._zcodeFamily,
          zcodeJwtToken: tokens._zcodeJwtToken,
          oauthAccessToken: tokens.access_token,
        },
      });
      return { plan };
    } catch (error) {
      return { planError: error?.message || String(error) };
    }
  },
  mapTokens: (tokens, extra) => {
    const family = tokens._zcodeFamily === "bigmodel" ? "bigmodel" : "zai";
    const user = tokens._zcodeUser || {};
    const name = family === "bigmodel" ? "ZCode (BigModel)" : "ZCode (Z.AI)";
    const displayName = user.name || user.email || name;
    return {
      accessToken: tokens.access_token,
      refreshToken: null,
      name: displayName,
      displayName,
      email: user.email || null,
      providerSpecificData: {
        authMethod: "oauth",
        family,
        zcodeJwtToken: tokens._zcodeJwtToken || undefined,
        oauthAccessToken: tokens.access_token,
        ...(tokens._zcodeRefreshToken ? { zaiRefreshToken: tokens._zcodeRefreshToken } : {}),
        ...(user.user_id ? { userId: user.user_id } : {}),
        ...(user.name ? { username: user.name } : {}),
        zcodeClientVersion: ZCODE_CONFIG.clientVersion,
        ...(extra?.plan?.persist || {}),
        ...(extra?.planError ? { zcodePlanError: extra.planError } : {}),
      },
    };
  },
};

export default zcode;
