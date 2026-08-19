/**
 * Qoder protocol profiles.
 *
 * Region/product knobs live here so chat stays profile-agnostic.
 * Production: intl + cn-work (qoderwork-cn).
 */

import {
  QODER_CHAT_URL_ENCODED,
  QODER_MODEL_LIST_URL,
  QODER_QUOTA_USAGE_URL,
  QODER_OPENAPI_BASE,
  QODER_CHAT_BASE,
  QODER_CHAT_BASE_ALT,
  QODER_CHAT_SIG_PATH,
  QODER_CENTER_BASE,
  QODER_LOGIN_URL,
  QODER_DEVICE_TOKEN_URL,
  QODER_USERINFO_URL,
  QODER_JOB_TOKEN_EXCHANGE_URL,
  QODER_IDE_VERSION,
  QODER_CLIENT_TYPE,
  QODER_DATA_POLICY,
  QODER_LOGIN_VERSION,
  QODER_MACHINE_OS,
  QODER_MACHINE_TYPE,
} from "./constants.js";

/**
 * @typedef {object} QoderProfile
 * @property {string} id
 * @property {string} openApiBase
 * @property {string} chatBase
 * @property {string} [centerBase]
 * @property {string} chatUrl
 * @property {string} [jobChatUrl] - chat URL for jt-* tokens
 * @property {string} modelListUrl
 * @property {string} [jobModelListUrl] - model-list URL for jt-* tokens
 * @property {string} quotaUrl
 * @property {string} deviceTokenUrl
 * @property {string} [quotaUserAgent] - User-Agent required by quota requests
 * @property {string} userInfoUrl
 * @property {string} jobTokenExchangeUrl - PAT (`pt-...`) → short-lived job
 *   token exchange; plain JSON POST, not cosy-signed.
 * @property {string} loginUrl
 * @property {string} [refreshTokenUrl]
 * @property {string} [deviceClientId] - OAuth device client_id (CN requires it)
 * @property {string} [deviceRedirectUri]
 * @property {string} sessionType
 * @property {string} businessProduct
 * @property {string} businessVersion
 * @property {string} [businessType] - business.type (CN work = "agent")
 * @property {boolean} [includeBusiness] - always attach business block (CN billing/attribution)
 * @property {string} clientType
 * @property {string} ideVersion
 * @property {string} loginVersion
 * @property {string} dataPolicy
 * @property {string} machineOs
 * @property {string} machineType
 */

/** Device-token refresh lives on openapi (not center). */
const INTL_DEVICE_REFRESH_URL = `${QODER_OPENAPI_BASE}/api/v1/deviceToken/refresh`;
const INTL_JOB_CHAT_URL = `${QODER_CHAT_BASE_ALT}/algo${QODER_CHAT_SIG_PATH}?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1`;
const INTL_JOB_MODEL_LIST_URL = `${QODER_CHAT_BASE_ALT}/algo/api/v2/model/list`;

/** @type {QoderProfile} */
export const INTL_PROFILE = {
  id: "intl",
  openApiBase: QODER_OPENAPI_BASE,
  chatBase: QODER_CHAT_BASE,
  centerBase: QODER_CENTER_BASE,
  chatUrl: QODER_CHAT_URL_ENCODED,
  jobChatUrl: INTL_JOB_CHAT_URL,
  modelListUrl: QODER_MODEL_LIST_URL,
  jobModelListUrl: INTL_JOB_MODEL_LIST_URL,
  quotaUrl: QODER_QUOTA_USAGE_URL,
  deviceTokenUrl: QODER_DEVICE_TOKEN_URL,
  userInfoUrl: QODER_USERINFO_URL,
  jobTokenExchangeUrl: QODER_JOB_TOKEN_EXCHANGE_URL,
  loginUrl: QODER_LOGIN_URL,
  refreshTokenUrl: INTL_DEVICE_REFRESH_URL,
  // The CLI sends client_id so login is registered as a CLI/IDE session.
  deviceClientId: "e883ade2-e6e3-4d6d-adf7-f92ceff5fdcb",
  sessionType: "qodercli",
  businessProduct: "cli",
  businessVersion: "1.0.0",
  clientType: QODER_CLIENT_TYPE,
  ideVersion: QODER_IDE_VERSION,
  loginVersion: QODER_LOGIN_VERSION,
  dataPolicy: QODER_DATA_POLICY,
  machineOs: QODER_MACHINE_OS,
  machineType: QODER_MACHINE_TYPE,
};

const CN_OPENAPI = "https://openapi.qoder.com.cn";
const CN_GATEWAY = "https://gateway.qoder.com.cn";
const CN_CHAT_SIG = "/api/v2/service/pro/sse/agent_chat_generation";
const CN_CHAT_URL = `${CN_GATEWAY}/algo${CN_CHAT_SIG}?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1`;

/**
 * QoderWork CN profile (desktop product qoderworkcn).
 * @type {QoderProfile}
 */
export const CN_WORK_PROFILE = {
  id: "cn-work",
  openApiBase: CN_OPENAPI,
  chatBase: CN_GATEWAY,
  centerBase: CN_GATEWAY,
  // CN quota endpoints require the desktop product identity.
  quotaUserAgent: "QoderWork",
  chatUrl: CN_CHAT_URL,
  modelListUrl: `${CN_GATEWAY}/algo/api/v2/model/list?Encode=1`,
  quotaUrl: `${CN_OPENAPI}/api/v2/quota/usage`,
  deviceTokenUrl: `${CN_OPENAPI}/api/v1/deviceToken/poll`,
  userInfoUrl: `${CN_OPENAPI}/api/v1/userinfo`,
  jobTokenExchangeUrl: `${CN_OPENAPI}/api/v1/jobToken/exchange`,
  loginUrl: "https://qoder.com.cn/device/selectAccounts",
  refreshTokenUrl: `${CN_OPENAPI}/api/v1/deviceToken/refresh`,
  deviceClientId: "1c5e33e1-364d-4ce6-b02c-acaa81274a5c",
  deviceRedirectUri: "qoder-work-cn://",
  sessionType: "qoder_work",
  businessProduct: "qoder_work",
  businessVersion: "1.0.0",
  businessType: "agent",
  includeBusiness: true,
  clientType: "6",
  ideVersion: QODER_IDE_VERSION,
  loginVersion: QODER_LOGIN_VERSION,
  dataPolicy: QODER_DATA_POLICY,
  machineOs: QODER_MACHINE_OS,
  machineType: QODER_MACHINE_TYPE,
};

/** @type {QoderProfile} */
const DEFAULT_PROFILE = INTL_PROFILE;

/** @type {Record<string, QoderProfile>} */
const PROFILES = {
  intl: INTL_PROFILE,
  "cn-work": CN_WORK_PROFILE,
};

/**
 * @param {string | QoderProfile | null | undefined} profileOrId
 * @returns {QoderProfile}
 */
export function resolveProfile(profileOrId) {
  if (profileOrId == null || profileOrId === "") return DEFAULT_PROFILE;
  if (typeof profileOrId === "object") {
    if (!profileOrId.chatUrl) {
      throw new Error("qoder profile object requires chatUrl");
    }
    return profileOrId;
  }
  if (typeof profileOrId === "string") {
    const found = PROFILES[profileOrId];
    if (found) return found;
    throw new Error(`qoder: unknown protocol profile "${profileOrId}"`);
  }
  throw new Error("qoder: invalid protocol profile");
}
