import { WINDSURF_CONFIG } from "../constants/oauth.js";
import { extractJsonPath } from "./_shared.js";

// ───────────────────────────────────────────────────────────────────────────
// Windsurf OAuth helpers
// ───────────────────────────────────────────────────────────────────────────

async function windsurfSeatRequest(baseUrl, path, body) {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": WINDSURF_CONFIG.userAgent,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Windsurf ${path} HTTP ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { throw new Error(`Windsurf ${path} invalid JSON`); }
}

// Parse Windsurf callback (query string or full URL): ?access_token=...&state=...
function parseWindsurfCallback(raw, expectedState) {
  const text = String(raw || "").trim();
  let queryStr = text;
  if (text.includes("?")) queryStr = text.slice(text.indexOf("?") + 1);
  if (text.startsWith("#")) queryStr = text.slice(1);
  const params = Object.fromEntries(new URLSearchParams(queryStr));
  const pick = (keys) => {
    for (const k of keys) { const v = params[k]; if (v && String(v).trim()) return String(v).trim(); }
    return null;
  };
  const err = pick(["error"]);
  if (err) {
    const desc = pick(["error_description"]);
    throw new Error(desc ? `Windsurf auth failed: ${err} (${desc})` : `Windsurf auth failed: ${err}`);
  }
  const accessToken = pick(["access_token", "token"]);
  if (!accessToken) throw new Error("Windsurf callback missing access_token");
  const state = pick(["state"]);
  if (expectedState && state && state !== expectedState) {
    throw new Error("Windsurf callback state mismatch");
  }
  return { firebaseIdToken: accessToken };
}

// POST RegisterUser {firebase_id_token} → {apiKey, apiServerUrl, name}
async function fetchWindsurfRegisterUser(firebaseIdToken) {
  const data = await windsurfSeatRequest(WINDSURF_CONFIG.registerApiBaseUrl, WINDSURF_CONFIG.registerPath, {
    firebase_id_token: firebaseIdToken,
  });
  const apiKey = extractJsonPath(data, [["apiKey"], ["api_key"]]);
  if (!apiKey) throw new Error("Windsurf RegisterUser missing apiKey");
  const apiServerUrl = extractJsonPath(data, [["apiServerUrl"], ["api_server_url"]]) || WINDSURF_CONFIG.defaultApiServerUrl;
  const name = extractJsonPath(data, [["name"]]);
  return { apiKey, apiServerUrl, name };
}

// Best-effort: GetOneTimeAuthToken → GetCurrentUser → email/name.
async function fetchWindsurfUserInfo(apiServerUrl, firebaseIdToken) {
  try {
    const authRes = await windsurfSeatRequest(apiServerUrl, WINDSURF_CONFIG.oneTimeAuthPath, { firebaseIdToken });
    const authToken = extractJsonPath(authRes, [["authToken"], ["auth_token"]]);
    if (!authToken) return { email: null, name: null };
    const userRes = await windsurfSeatRequest(apiServerUrl, WINDSURF_CONFIG.currentUserPath, {
      authToken,
      includeSubscription: true,
    });
    const user = userRes.user || userRes;
    return {
      email: extractJsonPath(user, [["email"]]),
      name: extractJsonPath(user, [["name"]]),
    };
  } catch { return { email: null, name: null }; }
}

// Windsurf — browser OAuth: windsurf.com/signin →
// local callback (firebase JWT) → RegisterUser → apiKey (used as credential).
const windsurf = {
  config: WINDSURF_CONFIG,
  flowType: "authorization_code",
  callbackPath: WINDSURF_CONFIG.callbackPath,
  buildAuthUrl: (config, redirectUri, state) => {
    const params = new URLSearchParams({
      response_type: "token",
      client_id: config.clientId,
      redirect_uri: redirectUri,
      state,
      prompt: "login",
      redirect_parameters_type: "query",
      workflow: "onboarding",
    });
    return `${config.authBaseUrl}${config.signInPath}?${params.toString()}`;
  },
  exchangeToken: async (config, code, redirectUri, codeVerifier, state) => {
    const trimmed = String(code || "").trim();
    const looksCallback = trimmed.includes("?") || trimmed.includes("access_token=");
    if (!looksCallback) {
      // Paste-token mode: sk-ws-... apiKey OR firebase JWT (eyJ...). Strip "Bearer " if pasted.
      const clean = trimmed.replace(/^Bearer\s+/i, "");
      if (clean.startsWith("sk-ws-")) {
        return { accessToken: clean, refreshToken: null, expiresIn: null, apiServerUrl: config.defaultApiServerUrl, firebaseIdToken: null, _authMethod: "imported" };
      }
      const reg = await fetchWindsurfRegisterUser(clean);
      return { accessToken: reg.apiKey, refreshToken: null, expiresIn: null, apiServerUrl: reg.apiServerUrl, firebaseIdToken: clean, _authMethod: "imported" };
    }
    const { firebaseIdToken } = parseWindsurfCallback(trimmed, state);
    const reg = await fetchWindsurfRegisterUser(firebaseIdToken);
    return { accessToken: reg.apiKey, refreshToken: null, expiresIn: null, apiServerUrl: reg.apiServerUrl, firebaseIdToken, _authMethod: "oauth" };
  },
  postExchange: async (tokens) => {
    if (!tokens.firebaseIdToken) return { userInfo: { email: null, name: null } };
    const info = await fetchWindsurfUserInfo(tokens.apiServerUrl, tokens.firebaseIdToken);
    return { userInfo: info };
  },
  mapTokens: (tokens, extra) => ({
    accessToken: tokens.accessToken,
    refreshToken: null,
    expiresIn: null,
    email: extra?.userInfo?.email || undefined,
    displayName: extra?.userInfo?.name || undefined,
    providerSpecificData: {
      authMethod: tokens._authMethod || "oauth",
      apiServerUrl: tokens.apiServerUrl,
      firebaseIdToken: tokens.firebaseIdToken,
    },
  }),
};

export default windsurf;
