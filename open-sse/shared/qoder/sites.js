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
 *              from constants.js; rsaPublicKey currently shared by all sites).
 *              QwenWork sites add modelScene / businessProduct; Qoder leaves
 *              both undefined ⇒ "app" / the `chat` listing
 *              modelScene drives both the Cosy-Scene header and the
 *              /algo/api/v2/model/list array this site reads its catalog from
 *   deviceFlow device-flow specifics: redirectUri (null ⇒ omit redirect_uri)
 *   catalog    model catalog fallback (503) and site-specific model list path
 *   usage      quota endpoint: kind "quotaApi" (default) or "accountContext";
 *              path overrides the account-context endpoint (kind only)
 *   pat        whether personal access tokens (pt-…) are supported
 *   enterprise enterprise deployable marker (login requires a domain input)
 */

import { QODER_RSA_PUBLIC_KEY, qoderInferenceBase } from "./constants.js";
import { validateEnterpriseDomain } from "./enterpriseDomain.js";

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
  // Optional enterprise VPC ({instance}.vpc.qoder.com.cn): sign-in may take
  // an access domain; credentials with providerSpecificData.enterpriseHost
  // route every request to that host (see qoderInferenceBaseForSite).
  // enabled stays false — unlike qwenwork-enterprise, the domain is optional.
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
    modelScene: "qwork",
    businessProduct: "qoder_work",
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
    modelScene: "qwork",
    businessProduct: "qoder_work",
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
 * web access domain captured at sign-in) overrides the placeholder bases.
 * Qoder CN VPC splits into web/openapi/gateway hosts (chat → gateway);
 * QwenWork enterprise is a single host. The enterprise's tokens never
 * leave its own domains.
 */
export function qoderInferenceBaseForSite(credentials, site) {
  const enterpriseBase = qoderEnterpriseServiceBase(credentials, site, "gateway");
  if (enterpriseBase) return enterpriseBase;
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

/** The Qoder CN enterprise VPC web-domain namespace: {id}.vpc.qoder.com.cn. */
export const QODER_VPC_SUFFIX = ".vpc.qoder.com.cn";

/** True when host is a Qoder CN VPC web access domain (instance label + suffix). */
export function isQoderVpcHost(host) {
  const h = normalizeEnterpriseHost(host);
  if (!h || !h.endsWith(QODER_VPC_SUFFIX) || h.length <= QODER_VPC_SUFFIX.length) return false;
  const id = h.slice(0, h.length - QODER_VPC_SUFFIX.length);
  return !id.includes("."); // a single instance label, not nested subdomains
}

/**
 * Split a Qoder CN VPC web access domain into its service hosts. The instance
 * mirrors the public-cloud split (openapi.qoder.com.cn / gateway.qoder.com.cn):
 *   {id}.vpc.qoder.com.cn         → web console (login page, session-gated)
 *   {id}-openapi.vpc.qoder.com.cn → device flow / PAT exchange / userinfo / quota
 *   {id}-gateway.vpc.qoder.com.cn → COSY-signed chat / model list / refresh
 * Returns null unless the host is in the Qoder VPC namespace (so a typo or an
 * unrelated domain can never receive enterprise credentials).
 */
export function qoderVpcHosts(webHost) {
  const host = normalizeEnterpriseHost(webHost);
  if (!isQoderVpcHost(host)) return null;
  const id = host.slice(0, host.length - QODER_VPC_SUFFIX.length);
  return {
    web: host,
    openapi: `${id}-openapi${QODER_VPC_SUFFIX}`,
    gateway: `${id}-gateway${QODER_VPC_SUFFIX}`,
  };
}

/** True for the Qoder deployables (intl + CN); QwenWork sites are not Qoder. */
function isQoderSite(site) {
  return site?.id === "qoder" || site?.id === "qoder-cn";
}

/** Shared error for a Qoder enterprise host outside the VPC namespace. */
export const QODER_VPC_DOMAIN_ERROR =
  "Invalid enterprise VPC domain (expected {instance}.vpc.qoder.com.cn)";

/**
 * Validate a user/API-supplied Qoder CN access domain: a bare host or https://
 * address (like the sign-in prompt), but ONLY within {instance}.vpc.qoder.com.cn.
 * Returns the normalized bare host, or null for blank/invalid input.
 */
export function validateQoderVpcDomain(input) {
  const host = validateEnterpriseDomain(input);
  return host && isQoderVpcHost(host) ? host : null;
}

/**
 * Server-side namespace guard: null when enterpriseHost is absent (public
 * cloud) or a valid Qoder VPC host; an error string when it is non-blank but
 * malformed/out-of-namespace. Used by the validate/create APIs so an invalid
 * domain is rejected before any credential is exchanged or persisted.
 */
export function qoderEnterpriseHostError(input) {
  if (input == null) return null; // absent ⇒ public cloud
  if (typeof input !== "string") return QODER_VPC_DOMAIN_ERROR; // reject arrays/objects/numbers
  if (!input.trim()) return null;
  return validateQoderVpcDomain(input) ? null : QODER_VPC_DOMAIN_ERROR;
}

/**
 * Enterprise service base URL for a credential, by role ("gateway" for chat /
 * model list / refresh / queue / uploads, "openapi" for device flow / PAT /
 * userinfo / quota). The VPC split is detected from the DOMAIN ITSELF so
 * live-chat credentials (no top-level provider, site falls back to intl) still
 * route correctly. A Qoder-site credential whose enterpriseHost is non-blank
 * but outside the VPC namespace FAILS CLOSED (throws) — its tokens must never
 * reach an unrelated domain or silently fall back to the public cloud.
 * QwenWork enterprise keeps a single host for every role. Null when absent.
 */
export function qoderEnterpriseServiceBase(credentials, site, role = "gateway") {
  const raw = credentials?.providerSpecificData?.enterpriseHost;
  const host = normalizeEnterpriseHost(raw);
  if (isQoderSite(site)) {
    const present = raw != null && !(typeof raw === "string" && !raw.trim());
    if (present && !isQoderVpcHost(host)) {
      throw new Error(QODER_VPC_DOMAIN_ERROR);
    }
    if (!host) return null;
    const vpc = qoderVpcHosts(host);
    return `https://${role === "openapi" ? vpc.openapi : vpc.gateway}`;
  }
  if (!host) return null;
  return `https://${host}`;
}
export function isQoderFamilyProvider(providerId) {
  return Object.prototype.hasOwnProperty.call(QODER_SITES, providerId);
}

// Re-export the RSA key so constants.js stays the single historical import
// path for existing callers. The canonical definition lives there; see the
// note in constants.js.
export { QODER_RSA_PUBLIC_KEY };
