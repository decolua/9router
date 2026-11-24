/**
 * Qoder-family site registry.
 *
 * A "site" is one deployable of the Qoder-compatible stack (Qoder intl, Qoder
 * CN, QwenWork public cloud, QwenWork enterprise VPC …). Everything that
 * differs between deployables lives here so executors and services stay
 * site-agnostic:
 *
 *   id         unique provider id ("qoder", "qoder-cn", …)
 *   bases      per-site gateway hosts (see QODER_REGION_BASES for the shape)
 *   cosy       COSY header/signing overrides (undefined ⇒ Qoder IDE defaults
 *              from constants.js; rsaPublicKey currently shared by all sites)
 *   deviceFlow device-flow specifics: redirectUri (null ⇒ omit redirect_uri)
 *   catalog    model catalog fallback (503) and site-specific model list path
 *   usage      quota endpoint: kind "quotaApi" (default) or "accountContext";
 *              path overrides the account-context endpoint (kind only)
 *   pat        whether personal access tokens (pt-…) are supported
 *   enterprise enterprise deployable marker (login requires a domain input)
 */

import { QODER_RSA_PUBLIC_KEY, qoderInferenceBase } from "./constants.js";

export const QODER_SITE_QODER = Object.freeze({
  id: "qoder",
  bases: {
    chat: "https://api3.qoder.sh",
    chatAlt: "https://api2.qoder.sh",
    openApi: "https://openapi.qoder.sh",
    center: "https://center.qoder.sh",
    login: "https://qoder.com/device/selectAccounts",
    website: "https://qoder.com",
  },
  cosy: Object.freeze({
    // Values are the Qoder IDE defaults from constants.js — listed explicitly
    // only when they differ; absent keys fall back to those constants.
    rsaPublicKey: QODER_RSA_PUBLIC_KEY,
  }),
  deviceFlow: Object.freeze({ redirectUri: "qoder-ide://login" }),
  catalog: Object.freeze({ fallbackModels: null }),
  usage: Object.freeze({ kind: "quotaApi" }),
  pat: true,
  enterprise: Object.freeze({ enabled: false }),
});

export const QODER_SITE_QODER_CN = Object.freeze({
  id: "qoder-cn",
  bases: {
    chat: "https://gateway.qoder.com.cn",
    chatAlt: "https://gateway.qoder.com.cn",
    openApi: "https://openapi.qoder.com.cn",
    center: "https://gateway.qoder.com.cn",
    login: "https://qoder.com.cn/device/selectAccounts",
    website: "https://qoder.com.cn",
  },
  cosy: Object.freeze({
    rsaPublicKey: QODER_RSA_PUBLIC_KEY,
  }),
  deviceFlow: Object.freeze({ redirectUri: "qoder-ide://login" }),
  catalog: Object.freeze({ fallbackModels: null }),
  usage: Object.freeze({ kind: "quotaApi" }),
  pat: true,
  enterprise: Object.freeze({ enabled: false }),
});

export const QODER_SITE_QWENWORK = Object.freeze({
  id: "qwenwork",
  bases: {
    chat: "https://gateway.qwenwork.cn",
    chatAlt: "https://gateway.qwenwork.cn",
    openApi: "https://gateway.qwenwork.cn",
    center: "https://gateway.qwenwork.cn",
    login: "https://gateway.qwenwork.cn/device/selectAccounts",
    website: "https://qwenwork.cn",
  },
  cosy: Object.freeze({
    // QwenWork's desktop client (QwenWorkCN.app) sends these COSY values;
    // rsaPublicKey is the same RSA key as Qoder's.
    clientType: "6",
    ideVersion: "1.1.59",
    rsaPublicKey: QODER_RSA_PUBLIC_KEY,
  }),
  deviceFlow: Object.freeze({ redirectUri: "qwenwork-cn://" }),
  catalog: Object.freeze({ fallbackModels: null }),
  usage: Object.freeze({
    kind: "accountContext",
    path: "/api/v1/adapter/user/account-context?include=user,plan,quota",
  }),
  pat: false, // gateway.qwenwork.cn has no /api/v1/jobToken/exchange
  // QwenWork's device token is itself the chat token and its refresh
  // endpoint honors the device refresh token (unlike Qoder's 403). The
  // refresh asks as the desktop client does: target "c" (personal).
  deviceRefresh: Object.freeze({ enabled: true, target: "c" }),
  enterprise: Object.freeze({ enabled: false }),
  // Params from magpie-community/plugins PR #319 (qwenwork site). Public
  // cloud personal accounts; the enterprise VPC deployable is a separate
  // "qwenwork-enterprise" site (later task).
});

export const QODER_SITE_QWENWORK_ENTERPRISE = Object.freeze({
  id: "qwenwork-enterprise",
  bases: {
    // Public-cloud gateway placeholders — the real host is decided at login
    // time by the user-entered enterprise domain (enterpriseHost); every
    // runtime request goes to that domain instead.
    chat: "https://gateway.qwenwork.cn",
    chatAlt: "https://gateway.qwenwork.cn",
    openApi: "https://gateway.qwenwork.cn",
    center: "https://gateway.qwenwork.cn",
    login: "https://gateway.qwenwork.cn/device/selectAccounts",
    website: "https://qwenwork.cn",
  },
  cosy: Object.freeze({
    // Same clientId/COSY values as the public cloud (magpie PR #319).
    clientType: "6",
    ideVersion: "1.1.59",
    rsaPublicKey: QODER_RSA_PUBLIC_KEY,
  }),
  // 企业旗舰版 /device/selectAccounts 拒绝 redirect_uri；真实主机在登录时
  // 由用户输入域名决定（enterpriseHost）。
  deviceFlow: Object.freeze({ redirectUri: null }),
  // 503 fallback: the flagship deploys no catalog service — copied from the
  // public cloud's list, not checked against a flagship's own models
  // (magpie PR #319, QWORK_FALLBACK_LISTING.qwork).
  catalog: Object.freeze({
    fallbackModels: [
      { key: "flash", display_name: "标准", is_vl: false, is_reasoning: false, max_input_tokens: 131072 },
      { key: "pro", display_name: "高级", is_vl: false, is_reasoning: false, max_input_tokens: 131072 },
      { key: "qwen3.8-max-preview", display_name: "Qwen3.8-Max", is_vl: false, is_reasoning: false, max_input_tokens: 131072 },
    ],
  }),
  usage: Object.freeze({
    kind: "accountContext",
    path: "/api/v1/adapter/user/account-context?include=user,plan,quota",
  }),
  pat: false,
  deviceRefresh: Object.freeze({ enabled: true, target: "c" }),
  enterprise: Object.freeze({ enabled: true }),
});

/** All Qoder-family sites, keyed by provider id. */
export const QODER_SITES = Object.freeze({
  qoder: QODER_SITE_QODER,
  "qoder-cn": QODER_SITE_QODER_CN,
  qwenwork: QODER_SITE_QWENWORK,
  "qwenwork-enterprise": QODER_SITE_QWENWORK_ENTERPRISE,
});

/** Site object for a provider id; unknown ids fall back to Qoder intl. */
export function qoderSiteOf(providerId) {
  return QODER_SITES[providerId] || QODER_SITE_QODER;
}


/**
 * Inference base URL for a site's credential. Qoder intl keeps the
 * job-token (jt-…) split (api2 vs api3 — see qoderInferenceBase in
 * constants.js); every other site is a single gateway that serves all
 * token kinds, so its chat base is the answer outright.
 *
 * An enterprise credential's `providerSpecificData.enterpriseHost` (the
 * domain captured at sign-in) overrides everything: the enterprise's
 * tokens must never leave the enterprise domain, so the chat host is
 * always https://<enterpriseHost> regardless of the site table's
 * placeholder bases.
 */
export function qoderInferenceBaseForSite(credentials, site) {
  const enterpriseHost = normalizeEnterpriseHost(credentials?.providerSpecificData?.enterpriseHost);
  if (enterpriseHost) return `https://${enterpriseHost}`;
  if (site && site.id !== "qoder") return site.bases.chat;
  return qoderInferenceBase(credentials);
}

/** Validated lowercase enterprise host or null. */
export function normalizeEnterpriseHost(host) {
  if (typeof host !== "string") return null;
  const value = host.trim().toLowerCase();
  if (!value) return null;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(value) ? value : null;
}
export function isQoderFamilyProvider(providerId) {
  return Object.prototype.hasOwnProperty.call(QODER_SITES, providerId);
}

// Re-export the RSA key so constants.js stays the single historical import
// path for existing callers. The canonical definition lives there; see the
// note in constants.js.
export { QODER_RSA_PUBLIC_KEY };
