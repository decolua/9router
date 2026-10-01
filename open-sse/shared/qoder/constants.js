/**
 * Qoder API constants ported from CLIProxyAPIPlus qoder-provider branch.
 *
 * Qoder runs two regional sites with parallel endpoint shapes:
 *   intl (qoder)       CN (qoder-cn)
 *   openapi.qoder.sh   openapi.qoder.com.cn   - device flow + userinfo + quota usage
 *   center.qoder.sh    gateway.qoder.com.cn   - token refresh (best-effort, 403 for device tokens)
 *   api3.qoder.sh      gateway.qoder.com.cn   - inference (chat) + model list, requires COSY signing
 *   qoder.com/device   qoder.com.cn/device    - browser landing page for device authorization
 *
 * All path suffixes are identical between regions — only the hosts differ.
 * Region-aware consumers call qoder*Url(region) / qoderInferenceBase(creds, region)
 * and derive the region from the provider id via qoderRegionOf(). The named
 * QODER_* constants below keep the intl defaults for backward compatibility.
 */

export const QODER_REGION_INTL = "intl";
export const QODER_REGION_CN = "cn";

// Per-region base URLs. CN serves job tokens (jt-...) from the same gateway
// host — there is no api2-style split like intl's api2.qoder.sh.
const QODER_REGION_BASES = {
  [QODER_REGION_INTL]: {
    chat: "https://api3.qoder.sh",
    chatAlt: "https://api2.qoder.sh",
    openApi: "https://openapi.qoder.sh",
    center: "https://center.qoder.sh",
    login: "https://qoder.com/device/selectAccounts",
    website: "https://qoder.com",
  },
  [QODER_REGION_CN]: {
    chat: "https://gateway.qoder.com.cn",
    chatAlt: "https://gateway.qoder.com.cn",
    openApi: "https://openapi.qoder.com.cn",
    center: "https://gateway.qoder.com.cn",
    login: "https://qoder.com.cn/device/selectAccounts",
    website: "https://qoder.com.cn",
  },
};

/** Base URL set for a region; unknown regions fall back to intl. */
export function qoderRegionBases(region) {
  return QODER_REGION_BASES[region] || QODER_REGION_BASES[QODER_REGION_INTL];
}

/** Region for a provider id — "cn" for qoder-cn, "intl" otherwise. */
export function qoderRegionOf(providerId) {
  return providerId === "qoder-cn" ? QODER_REGION_CN : QODER_REGION_INTL;
}

export const QODER_OPENAPI_BASE = QODER_REGION_BASES[QODER_REGION_INTL].openApi;
export const QODER_CENTER_BASE = QODER_REGION_BASES[QODER_REGION_INTL].center;
export const QODER_CHAT_BASE = QODER_REGION_BASES[QODER_REGION_INTL].chat;
// Job-token (jt-...) traffic is rejected by api3 with "Login expired" (403);
// the official qodercli serves it from api2 instead (intl only).
export const QODER_CHAT_BASE_ALT = QODER_REGION_BASES[QODER_REGION_INTL].chatAlt;

export const QODER_LOGIN_URL = QODER_REGION_BASES[QODER_REGION_INTL].login;

// Device flow endpoints (region-aware variants; these are the intl defaults)
export function qoderOpenApiBase(region) {
  return qoderRegionBases(region).openApi;
}
export function qoderDeviceTokenUrl(region) {
  return `${qoderOpenApiBase(region)}/api/v1/deviceToken/poll`;
}
export function qoderUserInfoUrl(region) {
  return `${qoderOpenApiBase(region)}/api/v1/userinfo`;
}
export function qoderQuotaUsageUrl(region) {
  return `${qoderOpenApiBase(region)}/api/v2/quota/usage`;
}
export function qoderRefreshTokenUrl(region) {
  return `${qoderRegionBases(region).center}/algo/api/v3/user/refresh_token`;
}
export function qoderLoginUrl(region) {
  return qoderRegionBases(region).login;
}
export function qoderWebsiteUrl(region) {
  return qoderRegionBases(region).website;
}

export const QODER_DEVICE_TOKEN_URL = qoderDeviceTokenUrl(QODER_REGION_INTL);
export const QODER_USERINFO_URL = qoderUserInfoUrl(QODER_REGION_INTL);
export const QODER_QUOTA_USAGE_URL = qoderQuotaUsageUrl(QODER_REGION_INTL);
export const QODER_REFRESH_TOKEN_URL = qoderRefreshTokenUrl(QODER_REGION_INTL);

// PAT (Personal Access Token, pt-...) → short-lived job token (jt-...) exchange.
// PATs cannot sign COSY requests directly — they must be exchanged first.
// This endpoint is NOT COSY-signed (plain JSON POST).
export function qoderJobTokenExchangeUrl(region) {
  return `${qoderOpenApiBase(region)}/api/v1/jobToken/exchange`;
}
export const QODER_JOB_TOKEN_EXCHANGE_URL = qoderJobTokenExchangeUrl(QODER_REGION_INTL);

// Inference endpoints (under /algo on the chat host, all COSY-signed)
export const QODER_CHAT_SIG_PATH = "/api/v2/service/pro/sse/agent_chat_generation";
export const QODER_CHAT_URL = `${QODER_CHAT_BASE}/algo${QODER_CHAT_SIG_PATH}?FetchKeys=llm_model_result&AgentId=agent_common`;
export const QODER_CHAT_URL_ENCODED = `${QODER_CHAT_URL}&Encode=1`;
export function qoderModelListUrl(region) {
  return `${qoderRegionBases(region).chat}/algo/api/v2/model/list`;
}
export const QODER_MODEL_LIST_URL = qoderModelListUrl(QODER_REGION_INTL);
// Official qodercli uploads images here (COSY-signed PUT multipart, field "file")
// instead of inlining base64 into agent_chat_generation.
export const QODER_IMAGE_UPLOAD_SIG_PATH = "/api/v2/image/upload";

// Drop remaining inlined binaries if the Qoder JSON body would still exceed this.
// 30MB+ payloads are what blow past Claude-Code's ~200k context on the wire.
export const QODER_MAX_PAYLOAD_BYTES = 6 * 1024 * 1024;
// If OSS upload fails, keep tiny data-URIs; anything larger is stubbed.
export const QODER_INLINE_FALLBACK_MAX_BYTES = 512 * 1024;

// Context-window tier selection (see shared/qoder/contextTier.js). The IDE exposes the
// model's context_config tiers (200K/400K/1M); we auto-escalate when the estimated prompt
// (+ headroom, tokenizer variance) no longer fits the current max_input_tokens.
export const QODER_CONTEXT_TIER_HEADROOM = 0.15;
export const QODER_CONTEXT_TIER_ENV = "QODER_CONTEXT_TIER";
export const QODER_CONTEXT_TIER_MODES = Object.freeze({ AUTO: "auto", MAX: "max", DEFAULT: "default" });

/**
 * Job-token (jt-...) traffic must hit api2.qoder.sh — api3 rejects jt- with
 * "Login expired" (403). Device tokens (dt-...) stay on api3. PATs (pt-...)
 * are exchanged for jt- before this is consulted.
 */
export function qoderInferenceBase(credentials, region = QODER_REGION_INTL) {
  // CN serves every token kind from the single gateway host.
  if (region === QODER_REGION_CN) return QODER_REGION_BASES[QODER_REGION_CN].chat;
  const raw = credentials?.apiKey || credentials?.accessToken;
  if (
    typeof raw === "string" &&
    !raw.startsWith("pt-") &&
    (raw.startsWith("jt-") || (credentials?.accessToken || "").startsWith("jt-"))
  ) {
    return QODER_CHAT_BASE_ALT;
  }
  return QODER_CHAT_BASE;
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
  qfmodel: "qfmodel",
  qmodel_latest: "qmodel_latest",
  qmodel_38max: "qmodel_38max",
  dmodel: "dmodel",
  dfmodel: "dfmodel",
  gmodel: "gmodel",
  gfmodel: "gfmodel",
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
