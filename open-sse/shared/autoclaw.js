import crypto from "crypto";
import { randomUUID } from "crypto";

export const AUTOCLAW_APP_ID = "100003";
export const AUTOCLAW_APP_KEY = "38d2391985e2369a5fb8227d8e6cd5e5";
export const AUTOCLAW_BASE_URL = "https://autoglm-api.autoglm.ai";
export const AUTOCLAW_WEB_ORIGIN = "https://autoclaw.z.ai";
export const AUTOCLAW_REDIRECT_URI = `${AUTOCLAW_BASE_URL}/userapi/oauth/google/callback`;
export const AUTOCLAW_PROXY_URL = `${AUTOCLAW_BASE_URL}/autoclaw-proxy/proxy/autoclaw`;
export const AUTOCLAW_CHAT_COMPLETIONS_URL = `${AUTOCLAW_PROXY_URL}/chat/completions`;
export const AUTOCLAW_GOOGLE_OAUTH_URL = `${AUTOCLAW_BASE_URL}/userapi/overseasv1/google-oauth-url`;
export const AUTOCLAW_REFRESH_URL = `${AUTOCLAW_BASE_URL}/userapi/v1/refresh`;
export const AUTOCLAW_WALLET_URL = `${AUTOCLAW_BASE_URL}/agent-assetmgr/api/v2/wallets?biz_app_id=autoclaw`;
export const AUTOCLAW_VERSION = "1.10.0";
export const AUTOCLAW_CLIENT_TYPE = "web";

export const AUTOCLAW_MODEL_MAP = {
  "glm-5.2": "openrouter_glm-5.2",
  "glm-5-turbo": "zai_glm-5-turbo",
  "deepseek-v4-pro": "zai_auto",
  "deepseek-v4": "zai_auto",
  auto: "zai_auto",
};

export function normalizeAutoClawBearerToken(token) {
  const trimmed = String(token || "").trim();
  if (!trimmed) return "";
  return /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

export function stripAutoClawBearerPrefix(token) {
  return String(token || "").trim().replace(/^Bearer\s+/i, "");
}

export function resolveAutoClawUpstreamModel(model) {
  if (!model) return AUTOCLAW_MODEL_MAP["glm-5.2"];
  if (Object.values(AUTOCLAW_MODEL_MAP).includes(model)) return model;
  return AUTOCLAW_MODEL_MAP[model] || model;
}

export function generateAutoClawSign(timestamp) {
  return crypto
    .createHash("md5")
    .update(`${AUTOCLAW_APP_ID}&${timestamp}&${AUTOCLAW_APP_KEY}`)
    .digest("hex");
}

export function buildAutoClawAuthHeaders({
  timestamp = String(Math.floor(Date.now() / 1000)),
  traceId = randomUUID(),
  userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
} = {}) {
  return {
    accept: "*/*",
    "content-type": "application/json",
    origin: AUTOCLAW_WEB_ORIGIN,
    referer: `${AUTOCLAW_WEB_ORIGIN}/`,
    "user-agent": userAgent,
    "x-auth-appid": AUTOCLAW_APP_ID,
    "x-auth-timestamp": timestamp,
    "x-auth-sign": generateAutoClawSign(timestamp),
    "x-product": "autoclaw",
    "x-version": AUTOCLAW_VERSION,
    "x-tm": "web",
    "x-channel": "official",
    "x-client-type": AUTOCLAW_CLIENT_TYPE,
    "x-trace-id": traceId,
    "x-lang": "zh-CN",
  };
}

export function buildAutoClawProxyHeaders({
  accessToken,
  model,
  timestamp = String(Math.floor(Date.now() / 1000)),
  requestId = randomUUID(),
  traceId = randomUUID(),
  stream = true,
} = {}) {
  const headers = {
    "Content-Type": "application/json",
    "X-Authorization": normalizeAutoClawBearerToken(accessToken),
    "X-Request-Id": requestId,
    "X-Request-Model": resolveAutoClawUpstreamModel(model),
    "X-Auth-Appid": AUTOCLAW_APP_ID,
    "X-Auth-Timestamp": timestamp,
    "X-Auth-Sign": generateAutoClawSign(timestamp),
    "X-Product": "autoclaw",
    "X-Version": AUTOCLAW_VERSION,
    "X-Tm": "web",
    "X-Trace-Id": traceId,
  };
  if (stream) headers.Accept = "text/event-stream";
  return headers;
}
