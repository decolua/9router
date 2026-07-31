import crypto from "crypto";
import { TRAE_CONFIG } from "../constants/oauth.js";
import { extractJsonPath } from "./_shared.js";

// ───────────────────────────────────────────────────────────────────────────
// Trae (ByteDance marscode) OAuth helpers
// ───────────────────────────────────────────────────────────────────────────

// Per-login device context. No IDE access in 9router, so use stable defaults.
function buildTraeDeviceContext() {
  return {
    plugin_version: TRAE_CONFIG.defaultPluginVersion,
    machine_id: crypto.randomUUID(),
    device_id: TRAE_CONFIG.defaultDeviceId,
    x_device_brand: "unknown",
    x_device_type: "unknown",
    x_os_version: "unknown",
    x_env: "",
    x_app_version: TRAE_CONFIG.defaultAppVersion,
    x_app_type: TRAE_CONFIG.defaultAppType,
  };
}

// POST GetLoginGuidance → { Result: { LoginHost } }
async function fetchTraeLoginGuidance(loginTraceId) {
  const body = JSON.stringify({ loginTraceID: loginTraceId, login_trace_id: loginTraceId });
  let lastErr = "no successful response";
  for (const url of TRAE_CONFIG.loginGuidanceUrls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": TRAE_CONFIG.userAgent,
        },
        body,
      });
      if (!res.ok) { lastErr = `${url} HTTP ${res.status}`; continue; }
      const data = await res.json();
      const loginHost = extractJsonPath(data, [
        ["Result", "LoginHost"], ["Result", "loginHost"], ["Result", "LoginURL"],
        ["result", "loginHost"], ["data", "Result", "LoginHost"], ["data", "loginHost"],
        ["LoginHost"], ["loginHost"],
      ]);
      if (loginHost) return loginHost;
      lastErr = `${url} missing LoginHost`;
    } catch (e) { lastErr = `${url} ${e.message}`; }
  }
  throw new Error(`Trae GetLoginGuidance failed: ${lastErr}`);
}

// Build the browser verification URL the user opens to sign in.
function buildTraeVerificationUrl(loginHost, loginTraceId, callbackUrl, ctx) {
  const url = new URL(loginHost.startsWith("http") ? loginHost : `https://${loginHost.replace(/^\/+/, "")}`);
  url.pathname = TRAE_CONFIG.authorizationPath;
  const p = new URLSearchParams();
  p.set("login_version", "1");
  p.set("auth_from", "trae");
  p.set("login_channel", "native_ide");
  p.set("plugin_version", ctx.plugin_version);
  p.set("auth_type", "local");
  p.set("client_id", TRAE_CONFIG.clientId);
  p.set("redirect", "0");
  p.set("login_trace_id", loginTraceId);
  p.set("auth_callback_url", callbackUrl);
  p.set("machine_id", ctx.machine_id);
  p.set("device_id", ctx.device_id);
  p.set("x_device_id", ctx.device_id);
  p.set("x_machine_id", ctx.machine_id);
  p.set("x_device_brand", ctx.x_device_brand);
  p.set("x_device_type", ctx.x_device_type);
  p.set("x_os_version", ctx.x_os_version);
  p.set("x_env", ctx.x_env);
  p.set("x_app_version", ctx.x_app_version);
  p.set("x_app_type", ctx.x_app_type);
  url.search = p.toString();
  return url.toString();
}

// Parse the Trae OAuth callback (query string or full URL).
// Expected: ?isRedirect=true&refreshToken=...&loginHost=...[&x-cloudide-token=...]
function parseTraeCallback(raw) {
  const text = String(raw || "").trim();
  let queryStr = text;
  if (text.includes("?")) queryStr = text.slice(text.indexOf("?") + 1);
  if (text.startsWith("#")) queryStr = text.slice(1);
  const params = Object.fromEntries(new URLSearchParams(queryStr));
  const pick = (keys) => {
    for (const k of keys) { const v = params[k]; if (v && String(v).trim()) return String(v).trim(); }
    return null;
  };
  const err = pick(["error", "error_code", "errorCode"]);
  if (err) {
    const desc = pick(["error_description", "error_desc", "message"]);
    throw new Error(desc ? `Trae auth failed: ${err} (${desc})` : `Trae auth failed: ${err}`);
  }
  const refreshToken = pick(["refreshToken", "refresh_token", "RefreshToken"]);
  if (!refreshToken) throw new Error("Trae callback missing refreshToken");
  const loginHost = pick(["loginHost", "login_host", "LoginHost", "host", "consoleHost"]);
  if (!loginHost) throw new Error("Trae callback missing loginHost");
  const cloudideToken = pick(["x-cloudide-token", "xCloudideToken", "accessToken", "access_token", "token"]);
  return { refreshToken, loginHost, cloudideToken };
}

// Allowed API origins for ExchangeToken/GetUserInfo — hardcoded HTTPS allowlist only.
// loginHost from the callback is intentionally NOT honored (SSRF guard: a callback
// attacker could otherwise point this at internal hosts/cloud metadata).
function traeApiOrigins() {
  return [...TRAE_CONFIG.apiOrigins];
}

// POST ExchangeToken {ClientID, RefreshToken, ClientSecret, UserID} → {Result:{AccessToken,RefreshToken,ExpiresAt}}
async function fetchTraeExchangeToken(refreshToken, cloudideToken) {
  const body = JSON.stringify({
    ClientID: TRAE_CONFIG.clientId,
    RefreshToken: refreshToken,
    ClientSecret: TRAE_CONFIG.clientSecret,
    UserID: "",
  });
  let lastErr = "no successful response";
  for (const origin of traeApiOrigins()) {
    const url = `${origin.replace(/\/$/, "")}${TRAE_CONFIG.exchangeTokenPath}`;
    try {
      const headers = {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": TRAE_CONFIG.userAgent,
      };
      if (cloudideToken) headers["x-cloudide-token"] = cloudideToken;
      const res = await fetch(url, { method: "POST", headers, body });
      const text = await res.text();
      if (!res.ok) { lastErr = `${url} HTTP ${res.status}`; continue; }
      let data; try { data = JSON.parse(text); } catch { lastErr = `${url} invalid JSON`; continue; }
      const accessToken = extractJsonPath(data, [
        ["Result", "AccessToken"], ["Result", "accessToken"], ["result", "access_token"], ["accessToken"],
      ]);
      if (!accessToken) {
        const msg = extractJsonPath(data, [["message"], ["msg"], ["error"], ["Result", "Message"]]) || "missing AccessToken";
        lastErr = `${url} ${msg}`;
        continue;
      }
      return {
        accessToken,
        refreshToken: extractJsonPath(data, [["Result", "RefreshToken"], ["result", "refresh_token"], ["refreshToken"]]) || refreshToken,
        expiresIn: null, // ExchangeToken returns ExpiresAt (absolute), converted below
        expiresAt: extractJsonPath(data, [["Result", "ExpiresAt"], ["Result", "expiresAt"], ["result", "expires_at"], ["expiresAt"]]),
      };
    } catch (e) { lastErr = `${url} ${e.message}`; }
  }
  throw new Error(`Trae ExchangeToken failed: ${lastErr}`);
}

// POST GetUserInfo with x-cloudide-token → identity fields used by SOLO common_params.
async function fetchTraeUserInfo(accessToken) {
  for (const origin of traeApiOrigins()) {
    const url = `${origin.replace(/\/$/, "")}${TRAE_CONFIG.getUserInfoPath}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": TRAE_CONFIG.userAgent,
          "x-cloudide-token": accessToken,
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) continue;
      const data = await res.json();
      return {
        email: extractJsonPath(data, [
          ["Result", "NonPlainTextEmail"], ["Result", "Email"], ["Result", "email"],
          ["email"], ["data", "email"],
        ]),
        name: extractJsonPath(data, [
          ["Result", "ScreenName"], ["Result", "Nickname"], ["Result", "Name"],
          ["result", "nickname"], ["nickname"], ["name"],
        ]),
        aiRegion: extractJsonPath(data, [["Result", "AIRegion"], ["Result", "aiRegion"], ["aiRegion"]]),
        region: extractJsonPath(data, [["Result", "Region"], ["Result", "region"], ["region"]]),
        tenant: extractJsonPath(data, [["Result", "TenantID"], ["Result", "tenantId"], ["tenantId"]]),
        userId: extractJsonPath(data, [["Result", "UserID"], ["Result", "userId"], ["userId"]]),
      };
    } catch { /* try next origin */ }
  }
  return { email: null, name: null };
}

// Map AIRegion (e.g. "SG", "US") → SOLO scope used in common_params.
function traeScopeForRegion(aiRegion) {
  const r = (aiRegion || "").toLowerCase();
  if (r === "sg" || r.includes("singapore")) return "marscode-sg";
  if (r === "cn" || r.includes("cn") || r.includes("china")) return "marscode-cn";
  return "marscode-us";
}

// Trae — browser OAuth: GetLoginGuidance → verification URL
// → local callback (refreshToken+loginHost) → ExchangeToken → GetUserInfo.
// state === config.loginTraceID so the proxy can match the callback.
const trae = {
  config: TRAE_CONFIG,
  flowType: "authorization_code",
  callbackPath: TRAE_CONFIG.callbackPath,
  prepareConfig: async (config) => {
    const loginTraceID = crypto.randomUUID();
    const loginHost = await fetchTraeLoginGuidance(loginTraceID);
    return { ...config, loginTraceID, loginHost };
  },
  buildAuthUrl: (config, redirectUri, state) => {
    const ctx = buildTraeDeviceContext();
    const traceId = config.loginTraceID || state;
    return buildTraeVerificationUrl(config.loginHost, traceId, redirectUri, ctx);
  },
  exchangeToken: async (config, code) => {
    const trimmed = String(code || "").trim();
    // Paste-token mode: raw Cloud-IDE-JWT (no refresh exchange)
    const looksCallback = /[?=&]/.test(trimmed) && (trimmed.includes("refreshToken") || trimmed.includes("refresh_token"));
    if (!looksCallback) {
      // Strip "Cloud-IDE-JWT " / "Bearer " prefix users paste from the Authorization header
      const clean = trimmed.replace(/^(Cloud-IDE-JWT|Bearer)\s+/i, "");
      return { accessToken: clean, refreshToken: null, expiresIn: TRAE_CONFIG.tokenLifetimeDays * 24 * 60 * 60, _authMethod: "imported" };
    }
    const { refreshToken, cloudideToken } = parseTraeCallback(trimmed);
    return { ...(await fetchTraeExchangeToken(refreshToken, cloudideToken)), _authMethod: "oauth" };
  },
  postExchange: async (tokens) => {
    const userInfo = await fetchTraeUserInfo(tokens.accessToken);
    return { userInfo };
  },
  mapTokens: (tokens, extra) => {
    const expiresIn = tokens.expiresIn
      || (tokens.expiresAt ? Math.max(60, Number(tokens.expiresAt) - Math.floor(Date.now() / 1000)) : TRAE_CONFIG.tokenLifetimeDays * 24 * 60 * 60);
    const ui = extra?.userInfo || {};
    const aiRegion = ui.aiRegion || "US-East";
    // SOLO common_params defaults — identity fields web_id/biz_user_id are not
    // exposed by GetUserInfo; empty strings are accepted upstream (verified).
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn,
      email: ui.email || undefined,
      displayName: ui.name || undefined,
      providerSpecificData: {
        authMethod: tokens._authMethod || "oauth",
        aiRegion,
        region: ui.region || aiRegion,
        tenant: ui.tenant || "marscode",
        userId: ui.userId || "",
        scope: traeScopeForRegion(aiRegion),
        webId: "",
        bizUserId: "",
        userUniqueId: "",
        appLanguage: "en",
        appVersion: TRAE_CONFIG.defaultAppVersion,
        userRegion: aiRegion === "SG" ? "SG" : "US",
        userIdentity: "Free",
      },
    };
  },
};

export default trae;
