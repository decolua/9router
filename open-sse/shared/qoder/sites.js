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
 *   usage      quota endpoint kind: "quotaApi" (default) or "accountContext"
 *   pat        whether personal access tokens (pt-…) are supported
 *   enterprise enterprise deployable marker (login requires a domain input)
 */

import { QODER_RSA_PUBLIC_KEY } from "./constants.js";

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

/** All Qoder-family sites, keyed by provider id. */
export const QODER_SITES = Object.freeze({
  qoder: QODER_SITE_QODER,
  "qoder-cn": QODER_SITE_QODER_CN,
});

/** Site object for a provider id; unknown ids fall back to Qoder intl. */
export function qoderSiteOf(providerId) {
  return QODER_SITES[providerId] || QODER_SITE_QODER;
}

/** True when the provider id belongs to the Qoder family (has a site entry). */
export function isQoderFamilyProvider(providerId) {
  return Object.prototype.hasOwnProperty.call(QODER_SITES, providerId);
}

// Re-export the RSA key so constants.js stays the single historical import
// path for existing callers. The canonical definition lives there; see the
// note in constants.js.
export { QODER_RSA_PUBLIC_KEY };
