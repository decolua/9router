import { proxyAwareFetch } from "../utils/proxyFetch.js";

const CODEXGO_AUTH_BASE_URL = "https://codexgo.eu/api/codex-auth";
const JWT_BASE64_BLOCK_SIZE = 4;

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function decodeJwtPayload(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padding = (JWT_BASE64_BLOCK_SIZE - (base64.length % JWT_BASE64_BLOCK_SIZE)) % JWT_BASE64_BLOCK_SIZE;
    return JSON.parse(Buffer.from(base64 + "=".repeat(padding), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function normalizeIsoTimestamp(value, nowMs) {
  if (typeof value === "string" && value.trim()) {
    const raw = value.trim();
    const parsed = new Date(raw);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();

    const trimmedFraction = raw.replace(/\.(\d{3})\d+(Z|[+-]\d{2}:?\d{2})$/, ".$1$2");
    const reparsed = new Date(trimmedFraction);
    if (Number.isFinite(reparsed.getTime())) return reparsed.toISOString();
  }
  return new Date(nowMs).toISOString();
}

function tokenExpiryMs(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  const exp = payload?.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= 0) return null;
  return exp < 1e12 ? exp * 1000 : exp;
}

function codexClaims(...payloads) {
  for (const payload of payloads) {
    const claims = payload?.["https://api.openai.com/auth"];
    if (isObject(claims)) return claims;
  }
  return {};
}

function profileClaims(...payloads) {
  for (const payload of payloads) {
    const claims = payload?.["https://api.openai.com/profile"];
    if (isObject(claims)) return claims;
  }
  return {};
}

export function normalizeCodexGoAccessResponse(payload, integrationToken, nowMs = Date.now()) {
  if (!isObject(payload)) {
    throw new Error("CodexGo response must be an object");
  }

  const tokens = isObject(payload.tokens) ? payload.tokens : {};
  const accessToken = firstString(tokens.access_token, tokens.accessToken, payload.access_token, payload.accessToken);
  if (!accessToken) {
    throw new Error("CodexGo response missing tokens.access_token");
  }

  const idToken = firstString(tokens.id_token, tokens.idToken, payload.id_token, payload.idToken);
  const accessPayload = decodeJwtPayload(accessToken);
  const idPayload = decodeJwtPayload(idToken);
  const auth = codexClaims(accessPayload, idPayload);
  const profile = profileClaims(accessPayload, idPayload);
  const expMs = tokenExpiryMs(accessToken);

  const email = firstString(payload.email, profile.email, idPayload?.email, accessPayload?.email);
  const chatgptAccountId = firstString(
    payload.account_id,
    payload.accountId,
    tokens.account_id,
    tokens.accountId,
    auth.chatgpt_account_id,
    idPayload?.account_id,
    accessPayload?.account_id,
  );
  const chatgptPlanType = firstString(
    payload.plan_type,
    payload.planType,
    auth.chatgpt_plan_type,
    idPayload?.plan_type,
    accessPayload?.plan_type,
  );
  const codexGoUserId = firstString(
    payload.user_id,
    payload.userId,
    auth.chatgpt_user_id,
    auth.user_id,
  );
  const codexGoAuthMode = firstString(payload.auth_mode, payload.authMode);

  const providerSpecificData = { authMethod: "codexgo" };
  if (chatgptAccountId) providerSpecificData.chatgptAccountId = chatgptAccountId;
  if (chatgptPlanType) providerSpecificData.chatgptPlanType = chatgptPlanType;
  if (codexGoUserId) providerSpecificData.codexGoUserId = codexGoUserId;
  if (codexGoAuthMode) providerSpecificData.codexGoAuthMode = codexGoAuthMode;

  const normalized = {
    accessToken,
    refreshToken: integrationToken,
    lastRefreshAt: normalizeIsoTimestamp(payload.last_refresh || payload.lastRefresh, nowMs),
    providerSpecificData,
  };

  if (idToken) normalized.idToken = idToken;
  if (email) normalized.email = email;
  if (expMs) {
    normalized.expiresAt = new Date(expMs).toISOString();
    const expiresIn = Math.floor((expMs - nowMs) / 1000);
    if (expiresIn > 0) normalized.expiresIn = expiresIn;
  }

  return normalized;
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function callCodexGo(endpoint, integrationToken, log, options = {}) {
  const token = typeof integrationToken === "string" ? integrationToken.trim() : "";
  if (!token) throw new Error("CodexGo integration token is required");

  const isManualRefresh = endpoint === "refresh";
  const response = await proxyAwareFetch(`${CODEXGO_AUTH_BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(isManualRefresh ? { "Content-Type": "application/json" } : {}),
    },
    ...(isManualRefresh ? { body: "{}" } : {}),
  }, options.proxyOptions || null);

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    log?.warn?.("CODEXGO", `${endpoint} failed`, { status: response.status, error: errorText });
    throw new Error(`CodexGo ${endpoint} failed with HTTP ${response.status}`);
  }

  const payload = await readJsonResponse(response);
  return normalizeCodexGoAccessResponse(payload, token, options.nowMs ?? Date.now());
}

export function useCodexGoSession(integrationToken, log = null, options = {}) {
  return callCodexGo("use", integrationToken, log, options);
}

export function refreshCodexGoSession(integrationToken, log = null, options = {}) {
  return callCodexGo("refresh", integrationToken, log, options);
}
