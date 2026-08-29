import crypto from "crypto";
import zcodeConfig from "./config.js";

const sessionIdByConnection = new Map();

function randomUuid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function sessionKey(credentials) {
  return (
    credentials?.connectionId ||
    credentials?.providerSpecificData?.zcodeUserId ||
    credentials?.providerSpecificData?.zcodeJwtToken?.slice(-24) ||
    "default"
  );
}

/** Stable x-session-id per connection (matches ZCode app session affinity). */
export function getZcodeSessionId(credentials) {
  const key = sessionKey(credentials);
  if (!sessionIdByConnection.has(key)) {
    sessionIdByConnection.set(key, randomUuid());
  }
  return sessionIdByConnection.get(key);
}

const ANTHROPIC_HEADER_KEYS = [
  "Anthropic-Version",
  "anthropic-version",
  "Anthropic-Beta",
  "anthropic-beta",
  "Anthropic-Dangerous-Direct-Browser-Access",
  "anthropic-dangerous-direct-browser-access",
];

export function stripAnthropicHeadersForZcodePlan(headers) {
  if (!headers || typeof headers !== "object") return headers;
  for (const key of ANTHROPIC_HEADER_KEYS) {
    delete headers[key];
  }
  return headers;
}

const ZCODE_CODING_PLAN_HEADER_KEYS = [
  "Authorization",
  "User-Agent",
  "X-ZCode-App-Version",
  "X-ZCode-Agent",
  "X-Title",
  "HTTP-Referer",
  "X-Aliyun-Captcha-Verify-Param",
  "X-Aliyun-Captcha-Verify-Region",
  "x-request-id",
  "x-zcode-trace-id",
  "x-query-id",
  "x-session-id",
];

export function clearZcodeCodingPlanHeaders(headers) {
  if (!headers || typeof headers !== "object") return headers;
  for (const key of ZCODE_CODING_PLAN_HEADER_KEYS) {
    delete headers[key];
  }
  return headers;
}

/**
 * Build ZCode Coding Plan upstream headers (zcode-plan URL fingerprint).
 * @param {object} credentials
 * @param {{ verifyParam?: string }} [options]
 */
export function buildZcodeCodingPlanHeaders(credentials, options = {}) {
  const jwt =
    credentials?.providerSpecificData?.zcodeJwtToken || credentials?.accessToken;
  const verifyParam =
    options.verifyParam ?? credentials?.providerSpecificData?._captchaVerifyParam;
  const appVersion = zcodeConfig.appVersion;
  const userAgent = zcodeConfig.userAgent;

  const headers = {
    Authorization: `Bearer ${jwt}`,
    "User-Agent": userAgent,
    "X-ZCode-App-Version": appVersion,
    "X-ZCode-Agent": "glm",
    "X-Title": "Z Code@electron",
    "HTTP-Referer": "https://zcode.z.ai/",
    "x-request-id": randomUuid(),
    "x-zcode-trace-id": randomUuid(),
    "x-query-id": randomUuid(),
    "x-session-id": getZcodeSessionId(credentials),
  };

  if (verifyParam) {
    headers["X-Aliyun-Captcha-Verify-Param"] = verifyParam;
    headers["X-Aliyun-Captcha-Verify-Region"] = "sgp";
  }

  return headers;
}

/** Merge ZCode Coding Plan headers into an existing header bag; strips Anthropic CLI headers. */
export function applyZcodeCodingPlanHeaders(headers, credentials, options = {}) {
  stripAnthropicHeadersForZcodePlan(headers);
  delete headers["x-api-key"];
  Object.assign(headers, buildZcodeCodingPlanHeaders(credentials, options));
  return headers;
}

/**
 * Build ZCode API key upstream headers (api.z.ai fingerprint — matches zcode_proxy).
 * @param {object} credentials
 * @param {{ verifyParam?: string }} [options]
 */
export function buildZcodeApiKeyHeaders(credentials, options = {}) {
  const verifyParam =
    options.verifyParam ?? credentials?.providerSpecificData?._captchaVerifyParam;

  const headers = {
    "anthropic-version": "2023-06-01",
    "User-Agent": zcodeConfig.userAgent,
    "X-ZCode-App-Version": zcodeConfig.appVersion,
    "X-ZCode-Agent": "glm",
    "HTTP-Referer": "https://zcode.z.ai/",
  };

  if (credentials?.apiKey) {
    headers["x-api-key"] = credentials.apiKey;
  }

  if (verifyParam) {
    headers["X-Aliyun-Captcha-Verify-Param"] = verifyParam;
  }

  return headers;
}

/** Merge ZCode API key headers; strips Coding Plan / Claude Code beta headers. */
export function applyZcodeApiKeyHeaders(headers, credentials, options = {}) {
  clearZcodeCodingPlanHeaders(headers);
  delete headers["Authorization"];
  delete headers["Anthropic-Beta"];
  delete headers["anthropic-beta"];
  delete headers["Anthropic-Version"];
  Object.assign(headers, buildZcodeApiKeyHeaders(credentials, options));
  return headers;
}

export const __test__ = {
  randomUuid,
  sessionKey,
  sessionIdByConnection,
};