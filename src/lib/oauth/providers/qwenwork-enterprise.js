import { QWENWORK_ENTERPRISE_CONFIG } from "../constants/oauth.js";
import { createQoderProvider } from "./qoder.js";
import { validateEnterpriseDomain } from "open-sse/shared/qoder/enterpriseDomain.js";

/**
 * QwenWork enterprise flagship (企业旗舰版).
 *
 * Wraps the Qoder device-flow provider with one delta: the deployable lives
 * on the enterprise's own domain, collected at sign-in
 * (options.enterpriseDomain, forwarded from the modal's domain input via the
 * device-code route's `domain` query param). Everything the plain config
 * points at gateway.qwenwork.cn is rewritten onto https://<domain> for this
 * login attempt — the enterprise's tokens never touch the public gateway.
 *
 * The enterprise flow also sends no redirect_uri (the flagship's
 * /device/selectAccounts refuses one), which QWENWORK_ENTERPRISE_CONFIG
 * expresses as redirectUri: null (QoderService omits null params).
 *
 * mapTokens persists `enterpriseHost` into providerSpecificData so every
 * runtime path (chat/model-list/refresh/usage) routes to the enterprise
 * domain; the account is labeled "<email|uid> (<domain>)".
 */

/** Rewrites every gateway URL in the config onto https://<domain>. */
function configForDomain(baseConfig, domain) {
  const root = `https://${domain}`;
  return {
    ...baseConfig,
    loginUrl: `${root}/device/selectAccounts`,
    deviceTokenUrl: `${root}/api/v1/deviceToken/poll`,
    refreshUrl: `${root}/api/v1/deviceToken/refresh`,
    userInfoUrl: `${root}/api/v1/adapter/user/account-context?include=user,plan,quota,page,data_sharing`,
    quotaUsageUrl: `${root}/api/v1/adapter/user/account-context?include=user,plan,quota`,
  };
}

const base = createQoderProvider(QWENWORK_ENTERPRISE_CONFIG);

export default {
  ...base,
  config: QWENWORK_ENTERPRISE_CONFIG,
  flowType: "device_code",
  requestDeviceCode: async (cfg, codeChallenge, options = {}) => {
    const domain = validateEnterpriseDomain(options.enterpriseDomain ?? "");
    if (!domain) {
      throw new Error("请输入有效的企业域名（如 your-company.vpc.qwenwork.cn，或 https:// 开头的完整地址），不要带路径");
    }
    // The public-cloud siteId stays in the config for mapTokens; the per-site
    // gateway URLs are rewritten onto the enterprise host for this attempt.
    const enterpriseCfg = configForDomain(cfg, domain);
    const deviceData = await base.requestDeviceCode(enterpriseCfg, codeChallenge, options);
    // Thread the domain through to mapTokens (the modal forwards extraData
    // on poll; the route merges _qwenworkDomain into the config there).
    return { ...deviceData, _qwenworkDomain: domain };
  },
  pollToken: async (cfg, deviceCode, codeVerifier, extraData) => {
    const domain = validateEnterpriseDomain(extraData?._qwenworkDomain ?? "");
    if (!domain) {
      return {
        ok: false,
        data: { error: "invalid_request", error_description: "Missing enterprise domain" },
      };
    }
    const enterpriseCfg = configForDomain(cfg, domain);
    const result = await base.pollToken(enterpriseCfg, deviceCode, codeVerifier, extraData);
    // Thread the domain into the token payload so mapTokens can persist it
    // (mapTokens only sees pollToken's result.data).
    if (result.ok && result.data) {
      return { ...result, data: { ...result.data, _qwenworkDomain: domain } };
    }
    return result;
  },
  mapTokens: (tokens) => {
    const domain = validateEnterpriseDomain(tokens._qwenworkDomain ?? "");
    const baseResult = base.mapTokens(tokens);
    if (!domain) return baseResult;
    // Tell the same person's public and enterprise accounts apart.
    const labeled = displayName.endsWith(`(${domain})`)
      ? displayName
      : `${displayName} (${domain})`.trim();
    return {
      ...baseResult,
      displayName: labeled,
      providerSpecificData: {
        ...baseResult.providerSpecificData,
        // Runtime routing key: every outbound request for this connection
        // goes to https://<enterpriseHost> — the enterprise's tokens never
        // leave the enterprise domain.
        enterpriseHost: domain,
      },
    };
  },
};
