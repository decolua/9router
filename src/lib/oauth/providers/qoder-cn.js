import { QODER_CN_CONFIG } from "../constants/oauth.js";
import { createQoderProvider } from "./qoder.js";
import { qoderVpcHosts, validateQoderVpcDomain } from "open-sse/shared/qoder/sites.js";

/**
 * Qoder CN (qoder.com.cn) — same device flow as intl Qoder, CN endpoints.
 *
 * Optional enterprise VPC (企业专属版): the deployable lives on the
 * organization's own domain ({instance}.vpc.qoder.com.cn), collected at
 * sign-in (options.enterpriseDomain, forwarded from the modal's optional
 * domain input via the device-code route's `domain` query param). Blank ⇒
 * public cloud, byte-identical to the plain CN flow. When a domain is
 * given, every gateway URL in the config is rewritten onto https://<domain>
 * for this login attempt — the enterprise's tokens never touch the public
 * gateway.
 *
 * mapTokens persists `enterpriseHost` into providerSpecificData so every
 * runtime path (chat/model-list/PAT exchange/usage) routes to the enterprise
 * domain; the account is labeled "<email|uid> (<domain>)".
 */

/**
 * Rewrites the config onto the enterprise's split hosts. The entered domain
 * is the web access domain ({id}.vpc.qoder.com.cn): the login page lives
 * there, device-flow poll / userinfo / quota use {id}-openapi.…, and chat /
 * refresh use {id}-gateway.… (mirrors the public-cloud openapi/gateway split).
 */
function configForDomain(baseConfig, domain) {
  const hosts = qoderVpcHosts(domain);
  const web = `https://${hosts.web}`;
  const openapi = `https://${hosts.openapi}`;
  const gateway = `https://${hosts.gateway}`;
  return {
    ...baseConfig,
    openApiBaseUrl: openapi,
    centerBaseUrl: gateway,
    chatBaseUrl: gateway,
    loginUrl: `${web}/device/selectAccounts`,
    deviceTokenUrl: `${openapi}/api/v1/deviceToken/poll`,
    refreshUrl: `${gateway}/algo/api/v3/user/refresh_token`,
    userInfoUrl: `${openapi}/api/v1/userinfo`,
    quotaUsageUrl: `${openapi}/api/v2/quota/usage`,
  };
}

const base = createQoderProvider(QODER_CN_CONFIG);

export default {
  ...base,
  config: QODER_CN_CONFIG,
  flowType: "device_code",
  requestDeviceCode: async (cfg, codeChallenge, options = {}) => {
    const raw = String(options.enterpriseDomain ?? "").trim();
    // No domain ⇒ public cloud qoder.com.cn, unchanged CN flow.
    if (!raw) return base.requestDeviceCode(cfg, codeChallenge, options);
    const domain = validateQoderVpcDomain(raw);
    if (!domain) {
      throw new Error("请输入有效的企业接入域名（如 your-company.vpc.qoder.com.cn，或 https:// 开头的完整地址），不要带路径");
    }
    const deviceData = await base.requestDeviceCode(configForDomain(cfg, domain), codeChallenge, options);
    // Thread the domain through to mapTokens (the modal forwards extraData
    // on poll; pollToken merges _qoderDomain into the token payload there).
    return { ...deviceData, _qoderDomain: domain };
  },
  pollToken: async (cfg, deviceCode, codeVerifier, extraData) => {
    const raw = String(extraData?._qoderDomain ?? "").trim();
    if (!raw) return base.pollToken(cfg, deviceCode, codeVerifier, extraData);
    const domain = validateQoderVpcDomain(raw);
    if (!domain) {
      return {
        ok: false,
        data: { error: "invalid_request", error_description: "Invalid enterprise domain" },
      };
    }
    const result = await base.pollToken(configForDomain(cfg, domain), deviceCode, codeVerifier, extraData);
    // Thread the domain into the token payload so mapTokens can persist it
    // (mapTokens only sees pollToken's result.data).
    if (result.ok && result.data) {
      return { ...result, data: { ...result.data, _qoderDomain: domain } };
    }
    return result;
  },
  mapTokens: (tokens) => {
    const baseResult = base.mapTokens(tokens);
    const domain = validateQoderVpcDomain(tokens._qoderDomain ?? "");
    if (!domain) return baseResult;
    // Tell the same person's public and enterprise accounts apart.
    const labeled = baseResult.displayName?.endsWith(`(${domain})`)
      ? baseResult.displayName
      : `${baseResult.displayName || ""} (${domain})`.trim();
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