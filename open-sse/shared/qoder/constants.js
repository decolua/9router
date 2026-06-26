/**
 * Qoder API constants ported from CLIProxyAPIPlus qoder-provider branch.
 *
 * Endpoint set:
 *   openapi.qoder.sh   - device flow + userinfo + quota usage
 *   center.qoder.sh    - token refresh (best-effort, currently 403 for device tokens)
 *   api3.qoder.sh      - inference (chat) + model list, requires COSY signing
 *   qoder.com/device   - browser landing page for device authorization
 */

export const QODER_OPENAPI_BASE = "https://openapi.qoder.sh";
export const QODER_CENTER_BASE = "https://center.qoder.sh";
export const QODER_CHAT_BASE = "https://api3.qoder.sh";

export const QODER_LOGIN_URL = "https://qoder.com/device/selectAccounts";

// Device flow endpoints
export const QODER_DEVICE_TOKEN_URL = `${QODER_OPENAPI_BASE}/api/v1/deviceToken/poll`;
export const QODER_USERINFO_URL = `${QODER_OPENAPI_BASE}/api/v1/userinfo`;
export const QODER_QUOTA_USAGE_URL = `${QODER_OPENAPI_BASE}/api/v2/quota/usage`;
export const QODER_REFRESH_TOKEN_URL = `${QODER_CENTER_BASE}/algo/api/v3/user/refresh_token`;

// Inference endpoints (under /algo on api3.qoder.sh, all COSY-signed)
export const QODER_CHAT_SIG_PATH = "/api/v2/service/pro/sse/agent_chat_generation";
export const QODER_CHAT_URL = `${QODER_CHAT_BASE}/algo${QODER_CHAT_SIG_PATH}?FetchKeys=llm_model_result&AgentId=agent_common`;
export const QODER_CHAT_URL_ENCODED = `${QODER_CHAT_URL}&Encode=1`;
export const QODER_MODEL_LIST_URL = `${QODER_CHAT_BASE}/algo/api/v2/model/list`;

export const QODER_CN_OPENAPI_BASE = "https://openapi.qoder.com.cn";
export const QODER_CN_CHAT_BASE = "https://api3.qoder.com.cn";
export const QODER_CN_LOGIN_URL = "https://qoder.com.cn/users/sign-in";
export const QODER_CN_DEVICE_SELECT_URL = "https://qoder.com.cn/device/selectAccounts";
export const QODER_CN_DEVICE_TOKEN_URL = `${QODER_CN_OPENAPI_BASE}/api/v1/deviceToken/poll`;
export const QODER_CN_USERINFO_URL = `${QODER_CN_OPENAPI_BASE}/api/v1/userinfo`;
export const QODER_CN_QUOTA_USAGE_URL = `${QODER_CN_OPENAPI_BASE}/api/v2/quota/usage`;
export const QODER_CN_CHAT_URL = `${QODER_CN_CHAT_BASE}/algo${QODER_CHAT_SIG_PATH}?FetchKeys=llm_model_result&AgentId=agent_common`;
export const QODER_CN_CHAT_URL_ENCODED = `${QODER_CN_CHAT_URL}&Encode=1`;
export const QODER_CN_MODEL_LIST_URL = `${QODER_CN_CHAT_BASE}/algo/api/v2/model/list`;

export const QODER_INTL_CONFIG = Object.freeze({
  id: "qoder",
  region: "intl",
  openApiBaseUrl: QODER_OPENAPI_BASE,
  centerBaseUrl: QODER_CENTER_BASE,
  chatBaseUrl: QODER_CHAT_BASE,
  loginUrl: QODER_LOGIN_URL,
  deviceAuthorizationUrl: QODER_LOGIN_URL,
  deviceTokenUrl: QODER_DEVICE_TOKEN_URL,
  refreshUrl: QODER_REFRESH_TOKEN_URL,
  userInfoUrl: QODER_USERINFO_URL,
  quotaUsageUrl: QODER_QUOTA_USAGE_URL,
  chatUrl: QODER_CHAT_URL,
  chatUrlEncoded: QODER_CHAT_URL_ENCODED,
  modelListUrl: QODER_MODEL_LIST_URL,
});

export const QODER_CN_CONFIG = Object.freeze({
  id: "qoder-cn",
  region: "cn",
  openApiBaseUrl: QODER_CN_OPENAPI_BASE,
  centerBaseUrl: "",
  chatBaseUrl: QODER_CN_CHAT_BASE,
  loginUrl: QODER_CN_LOGIN_URL,
  deviceAuthorizationUrl: QODER_CN_DEVICE_SELECT_URL,
  deviceTokenUrl: QODER_CN_DEVICE_TOKEN_URL,
  refreshUrl: "",
  userInfoUrl: QODER_CN_USERINFO_URL,
  quotaUsageUrl: QODER_CN_QUOTA_USAGE_URL,
  chatUrl: QODER_CN_CHAT_URL,
  chatUrlEncoded: QODER_CN_CHAT_URL_ENCODED,
  modelListUrl: QODER_CN_MODEL_LIST_URL,
  clientId: "1c5e33e1-364d-4ce6-b02c-acaa81274a5c",
  redirectUri: "qoder-work-cn://",
  bizVariant: "qoderwork",
  useSignInCallback: true,
});

function qoderRegionFromSource(source) {
  if (typeof source === "string") return source;
  if (!source || typeof source !== "object") return "";
  const psd = source.providerSpecificData || {};
  return (
    source.region ||
    psd.region ||
    source.provider ||
    source.providerId ||
    source.id ||
    psd.provider ||
    psd.providerId ||
    ""
  );
}

export function isQoderCnSource(source) {
  const value = String(qoderRegionFromSource(source) || "").toLowerCase();
  return value === "qoder-cn" || value === "qoder_cn" || value === "qdc" || value === "cn" || value === "china";
}

export function getQoderEndpointConfig(source = "qoder") {
  return isQoderCnSource(source) ? QODER_CN_CONFIG : QODER_INTL_CONFIG;
}

// COSY header constants. These are not arbitrary — the upstream signature
// validation matches them against the values used at signing time.
export const QODER_IDE_VERSION = "1.0.0";
export const QODER_CLIENT_TYPE = "5";
export const QODER_DATA_POLICY = "disagree";
export const QODER_LOGIN_VERSION = "v2";
export const QODER_MACHINE_OS = "x86_64_windows";
export const QODER_MACHINE_TYPE = "5";

// Canonical model identifiers. Identity map — keep as a map so callers can
// cheaply test "is this a known qoder model?" before sending the request.
export const QODER_MODEL_MAP = {
  // Tier models
  auto: "auto",
  ultimate: "ultimate",
  performance: "performance",
  efficient: "efficient",
  lite: "lite",
  // Frontier models
  qmodel: "qmodel",
  qmodel_latest: "qmodel_latest",
  dmodel: "dmodel",
  dfmodel: "dfmodel",
  gm51model: "gm51model",
  kmodel: "kmodel",
  mmodel: "mmodel",
};

// RSA public key for COSY encryption (extracted from Qoder IDE v0.9).
// Matches the CLIProxyAPIPlus branch and live qodercli traffic.
export const QODER_RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`;
