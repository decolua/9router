/**
 * Qoder API constants (intl defaults).
 *
 * Hosts live on Profile for multi-region; these feed INTL_PROFILE.
 * Model ids come from live /model/list (or registry UI), not a frozen map.
 */

export const QODER_OPENAPI_BASE = "https://openapi.qoder.sh";
export const QODER_CENTER_BASE = "https://center.qoder.sh";
export const QODER_CHAT_BASE = "https://api3.qoder.sh";

export const QODER_LOGIN_URL = "https://qoder.com/device/selectAccounts";

export const QODER_DEVICE_TOKEN_URL = `${QODER_OPENAPI_BASE}/api/v1/deviceToken/poll`;
export const QODER_USERINFO_URL = `${QODER_OPENAPI_BASE}/api/v1/userinfo`;
export const QODER_QUOTA_USAGE_URL = `${QODER_OPENAPI_BASE}/api/v2/quota/usage`;
export const QODER_REFRESH_TOKEN_URL = `${QODER_CENTER_BASE}/algo/api/v3/user/refresh_token`;

// PAT (Personal Access Token, pt-...) → short-lived job token (jt-...) exchange.
// PATs cannot sign COSY requests directly — they must be exchanged first.
// This endpoint is NOT COSY-signed (plain JSON POST).
export const QODER_JOB_TOKEN_EXCHANGE_URL = `${QODER_OPENAPI_BASE}/api/v1/jobToken/exchange`;

// Inference (COSY-signed). Chat path matches official agent_chat_generation + Encode=1.
export const QODER_CHAT_SIG_PATH = "/api/v2/service/pro/sse/agent_chat_generation";
export const QODER_CHAT_URL = `${QODER_CHAT_BASE}/algo${QODER_CHAT_SIG_PATH}?FetchKeys=llm_model_result&AgentId=agent_common`;
export const QODER_CHAT_URL_ENCODED = `${QODER_CHAT_URL}&Encode=1`;

// Bun 1.1.3 uses Encode=1 on model list; keep /algo prefix used by intl inference host.
export const QODER_MODEL_LIST_URL = `${QODER_CHAT_BASE}/algo/api/v2/model/list?Encode=1`;

// COSY fingerprint defaults (overridable via Profile).
export const QODER_IDE_VERSION = "1.0.0";
export const QODER_CLIENT_TYPE = "5";
export const QODER_DATA_POLICY = "disagree";
export const QODER_LOGIN_VERSION = "v2";
export function normalizeQoderMachineOs(arch = process.arch, platform = process.platform) {
  const normalizedArch = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : arch;
  const normalizedPlatform = platform === "win32" ? "windows" : platform;
  return `${normalizedArch}_${normalizedPlatform}`;
}

export const QODER_MACHINE_OS = normalizeQoderMachineOs();
export const QODER_MACHINE_TYPE = "5";

// RSA public key for COSY (same across IDE / CN / CLIProxy family).
export const QODER_RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`;
