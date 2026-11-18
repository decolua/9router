import { randomUUID } from "node:crypto";
import { ZCODE_CONFIG } from "./config.js";

const sessions = new Map();
const STRIP_HEADERS = [
  "x-api-key",
  "Anthropic-Version",
  "anthropic-version",
  "Anthropic-Beta",
  "anthropic-beta",
  "Anthropic-Dangerous-Direct-Browser-Access",
  "anthropic-dangerous-direct-browser-access",
];

function sessionKey(credentials) {
  return credentials?.connectionId
    || credentials?.providerSpecificData?.userId
    || credentials?.providerSpecificData?.zcodeJwtToken?.slice(-24)
    || "default";
}

export function getZcodeSessionId(credentials) {
  const key = sessionKey(credentials);
  if (!sessions.has(key)) sessions.set(key, randomUUID());
  return sessions.get(key);
}

export function applyZcodeHeaders(headers, credentials, verifyParam) {
  for (const key of STRIP_HEADERS) delete headers[key];
  Object.assign(headers, {
    Authorization: `Bearer ${credentials.providerSpecificData.zcodeJwtToken}`,
    "User-Agent": ZCODE_CONFIG.userAgent,
    "X-ZCode-App-Version": ZCODE_CONFIG.appVersion,
    "X-ZCode-Agent": "glm",
    "X-Title": "Z Code@electron",
    "HTTP-Referer": "https://zcode.z.ai/",
    "x-request-id": randomUUID(),
    "x-zcode-trace-id": randomUUID(),
    "x-query-id": randomUUID(),
    "x-session-id": getZcodeSessionId(credentials),
  });
  if (verifyParam) {
    headers["X-Aliyun-Captcha-Verify-Param"] = verifyParam;
    headers["X-Aliyun-Captcha-Verify-Region"] = "sgp";
  }
  return headers;
}

export const __test__ = { sessions };
