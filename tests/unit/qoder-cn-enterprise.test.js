/**
 * Unit tests for Qoder CN enterprise VPC support (企业专属版,
 * {instance}.vpc.qoder.com.cn) — the optional access-domain flow on the
 * existing qoder-cn provider.
 *
 * The VPC instance mirrors the public-cloud host split:
 *   {id}.vpc.qoder.com.cn         → web console (login page)
 *   {id}-openapi.vpc.qoder.com.cn → device flow / PAT exchange / userinfo / quota
 *   {id}-gateway.vpc.qoder.com.cn → COSY chat / model list / refresh
 *
 * Contracts locked here:
 *   - routing: chat/model-list go to the gateway host, PAT/userinfo/usage to
 *     the openapi host — never the public qoder.com.cn gateways nor the
 *     session-gated web host
 *   - login: the optional domain keeps the login page on the web host, polls
 *     on openapi, and mapTokens persists enterpriseHost (the web domain);
 *     blank domain keeps the public-cloud flow byte-identical
 *   - public cloud: without an enterpriseHost nothing changes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// proxyAwareFetch routes through the package's undici copy — stub it at
// the module boundary so runtime requests never touch the network.
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => globalThis.__stubFetch(...args),
}));

import {
  qoderSiteOf,
  qoderInferenceBaseForSite,
  qoderVpcHosts,
  isQoderVpcHost,
  qoderEnterpriseServiceBase,
  qoderEnterpriseHostError,
  validateQoderVpcDomain,
  QODER_VPC_DOMAIN_ERROR,
} from "../../open-sse/shared/qoder/sites.js";
import { QoderExecutor } from "../../open-sse/executors/qoder.js";
import { fetchQoderCatalogRaw, resolveQoderCredentials } from "../../open-sse/services/qoderModels.js";
import { getQoderUsage } from "../../open-sse/services/usage/misc.js";
import qoderCnProvider from "../../src/lib/oauth/providers/qoder-cn.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { rewriteQoderMessageAttachments } from "../../open-sse/shared/qoder/attachments.js";
import { parseQuotaData, getRemainingPercentage } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const ENT_HOST = "acme.vpc.qoder.com.cn";
const OPENAPI = "acme-openapi.vpc.qoder.com.cn";
const GATEWAY = "acme-gateway.vpc.qoder.com.cn";
const ENT_CREDS = {
  provider: "qoder-cn",
  accessToken: "dt-ent-token",
  providerSpecificData: {
    userId: "u-ent",
    enterpriseHost: ENT_HOST,
  },
};

beforeEach(() => {
  globalThis.__stubFetch = async () => {
    throw new Error("no stub configured — this request would hit the network");
  };
});

afterEach(() => {
  delete globalThis.__stubFetch;
});

describe("VPC host derivation", () => {
  it("splits the web access domain into openapi/gateway hosts", () => {
    expect(qoderVpcHosts(ENT_HOST)).toEqual({ web: ENT_HOST, openapi: OPENAPI, gateway: GATEWAY });
  });

  it("handles an instance id that itself contains hyphens", () => {
    expect(qoderVpcHosts("my-company.vpc.qoder.com.cn")).toEqual({
      web: "my-company.vpc.qoder.com.cn",
      openapi: "my-company-openapi.vpc.qoder.com.cn",
      gateway: "my-company-gateway.vpc.qoder.com.cn",
    });
  });

  it("returns null for junk", () => {
    expect(qoderVpcHosts("")).toBeNull();
    expect(qoderVpcHosts("https://acme.vpc.qoder.com.cn")).toBeNull();
  });

  it("routes by role: gateway for chat, openapi for PAT/usage", () => {
    const site = qoderSiteOf("qoder-cn");
    expect(qoderEnterpriseServiceBase(ENT_CREDS, site, "gateway")).toBe(`https://${GATEWAY}`);
    expect(qoderEnterpriseServiceBase(ENT_CREDS, site, "openapi")).toBe(`https://${OPENAPI}`);
    expect(qoderEnterpriseServiceBase({ providerSpecificData: {} }, site, "gateway")).toBeNull();
  });

  it("qwenwork enterprise keeps a single host for every role", () => {
    const site = qoderSiteOf("qwenwork-enterprise");
    const creds = { providerSpecificData: { enterpriseHost: "acme.vpc.qwenwork.cn" } };
    expect(qoderEnterpriseServiceBase(creds, site, "gateway")).toBe("https://acme.vpc.qwenwork.cn");
    expect(qoderEnterpriseServiceBase(creds, site, "openapi")).toBe("https://acme.vpc.qwenwork.cn");
  });
});

describe("enterprise routing (tokens never leave the enterprise domains)", () => {
  it("routes chat URLs to the gateway host", () => {
    const executor = new QoderExecutor("qoder-cn");
    const url = executor.buildUrl(ENT_CREDS);
    expect(url.startsWith(`https://${GATEWAY}/algo/`)).toBe(true);
    expect(url).not.toContain("gateway.qoder.com.cn");
    expect(url).not.toContain(`https://${ENT_HOST}/`);
  });

  it("keeps the public CN gateway without an enterpriseHost", () => {
    const executor = new QoderExecutor("qoder-cn");
    const url = executor.buildUrl({ provider: "qoder-cn", accessToken: "dt-public" });
    expect(url.startsWith("https://gateway.qoder.com.cn/")).toBe(true);
  });

  it("routes the model-list fetch to the gateway host", async () => {
    const calls = [];
    globalThis.__stubFetch = async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({ chat: [{ key: "ultimate", display_name: "Ultimate", max_input_tokens: 131072 }] }),
      };
    };
    const fetched = await fetchQoderCatalogRaw(ENT_CREDS, null, null, "cn", qoderSiteOf("qoder-cn"));
    expect(fetched.models.map((m) => m.id)).toEqual(["ultimate"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].startsWith(`https://${GATEWAY}/algo/api/v2/model/list`)).toBe(true);
    expect(calls[0]).not.toContain("gateway.qoder.com.cn");
  });

  it("exchanges an enterprise PAT on the openapi host (exchange + userinfo)", async () => {
    const calls = [];
    globalThis.__stubFetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes("/jobToken/exchange")) {
        return { ok: true, status: 200, json: async () => ({ token: "jt-ent", expires_in: 86400000 }) };
      }
      return { ok: true, status: 200, json: async () => ({ id: "u-ent" }) };
    };
    const resolved = await resolveQoderCredentials({
      provider: "qoder-cn",
      apiKey: "pt-ent-routing-test",
      providerSpecificData: { enterpriseHost: ENT_HOST },
    });
    expect(resolved.accessToken).toBe("jt-ent");
    expect(resolved.providerSpecificData.userId).toBe("u-ent");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(`https://${OPENAPI}/api/v1/jobToken/exchange`);
    expect(calls[1]).toBe(`https://${OPENAPI}/api/v1/userinfo`);
  });

  it("keeps the public CN openapi host for a PAT without an enterpriseHost", async () => {
    const calls = [];
    globalThis.__stubFetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes("/jobToken/exchange")) {
        return { ok: true, status: 200, json: async () => ({ token: "jt-pub", expires_in: 86400000 }) };
      }
      return { ok: true, status: 200, json: async () => ({ id: "u-pub" }) };
    };
    await resolveQoderCredentials({ provider: "qoder-cn", apiKey: "pt-pub-routing-test" });
    expect(calls[0]).toBe("https://openapi.qoder.com.cn/api/v1/jobToken/exchange");
    expect(calls[1]).toBe("https://openapi.qoder.com.cn/api/v1/userinfo");
  });

  it("reads quota from the openapi host when a usage URL override is given", async () => {
    const calls = [];
    globalThis.__stubFetch = async (url) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ userQuota: { total: 3000, used: 100, remaining: 2900 } }) };
    };
    const r = await getQoderUsage("dt-ent", null, "qoder-cn", `https://${OPENAPI}/api/v2/quota/usage`);
    expect(r.quotas.user.total).toBe(3000);
    expect(calls[0]).toBe(`https://${OPENAPI}/api/v2/quota/usage`);
  });

  it("keeps the registry quota URL without an override", async () => {
    const calls = [];
    globalThis.__stubFetch = async (url) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ userQuota: { total: 1, used: 0, remaining: 1 } }) };
    };
    await getQoderUsage("dt-pub", null, "qoder-cn");
    expect(calls[0]).toBe("https://openapi.qoder.com.cn/api/v2/quota/usage");
  });
});

describe("optional access-domain login flow", () => {
  const cfg = qoderCnProvider.config;

  it("keeps the login page on the web host", async () => {
    const data = await qoderCnProvider.requestDeviceCode(cfg, undefined, { enterpriseDomain: ENT_HOST });
    expect(data.verification_uri_complete.startsWith(`https://${ENT_HOST}/device/selectAccounts?`)).toBe(true);
    expect(data.verification_uri_complete.startsWith("https://qoder.com.cn/")).toBe(false);
    expect(data._qoderDomain).toBe(ENT_HOST);
  });

  it("accepts an https:// address and normalizes it to the host", async () => {
    const data = await qoderCnProvider.requestDeviceCode(cfg, undefined, { enterpriseDomain: `https://${ENT_HOST}` });
    expect(data._qoderDomain).toBe(ENT_HOST);
  });

  it("keeps the public-cloud flow byte-identical without a domain", async () => {
    const data = await qoderCnProvider.requestDeviceCode(cfg, undefined, {});
    expect(data.verification_uri_complete.startsWith("https://qoder.com.cn/device/selectAccounts?")).toBe(true);
    expect(data._qoderDomain).toBeUndefined();
  });

  it("rejects an invalid domain instead of silently falling back", async () => {
    await expect(
      qoderCnProvider.requestDeviceCode(cfg, undefined, { enterpriseDomain: "http://acme.vpc.qoder.com.cn/path" }),
    ).rejects.toThrow(/企业接入域名/);
  });

  it("polls the openapi host and threads the domain into the token payload", async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes("/deviceToken/poll")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ token: "dt-new", refresh_token: "rt-new", user_id: "u1", expires_in: 86400 }),
        };
      }
      // fetchUserInfo
      return { ok: true, status: 200, json: async () => ({ name: "Alice", email: "alice@acme.cn" }) };
    };
    try {
      const result = await qoderCnProvider.pollToken(cfg, "nonce-1", "verifier-1", { _qoderDomain: ENT_HOST });
      expect(result.ok).toBe(true);
      expect(result.data.access_token).toBe("dt-new");
      expect(result.data._qoderDomain).toBe(ENT_HOST);
      expect(calls[0].startsWith(`https://${OPENAPI}/api/v1/deviceToken/poll?`)).toBe(true);
      expect(calls[1]).toBe(`https://${OPENAPI}/api/v1/userinfo`);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("refuses to poll with an invalid domain (no network)", async () => {
    const result = await qoderCnProvider.pollToken(cfg, "nonce-1", "verifier-1", { _qoderDomain: "localhost" });
    expect(result.ok).toBe(false);
    expect(result.data.error).toBe("invalid_request");
  });

  it("mapTokens persists enterpriseHost (web domain) and labels the account", () => {
    const mapped = qoderCnProvider.mapTokens({
      access_token: "dt-new",
      refresh_token: "rt-new",
      expires_in: 86400,
      _qoderUserId: "u1",
      _qoderName: "Alice",
      _qoderDomain: ENT_HOST,
    });
    expect(mapped.providerSpecificData.enterpriseHost).toBe(ENT_HOST);
    expect(mapped.displayName).toBe(`Alice (${ENT_HOST})`);
  });

  it("mapTokens without a domain stores no enterpriseHost", () => {
    const mapped = qoderCnProvider.mapTokens({
      access_token: "dt-new",
      refresh_token: "rt-new",
      expires_in: 86400,
      _qoderUserId: "u1",
      _qoderName: "Alice",
    });
    expect(mapped.providerSpecificData.enterpriseHost).toBeUndefined();
    expect(mapped.displayName).toBe("Alice");
  });
});

describe("site registry", () => {
  it("qoder-cn keeps the optional-enterprise marker (domain not required)", () => {
    const site = qoderSiteOf("qoder-cn");
    expect(site.enterprise.enabled).toBe(false);
    expect(site.pat).toBe(true);
    // Enterprise chat routing derives the gateway host from the web domain.
    expect(qoderInferenceBaseForSite(ENT_CREDS, site)).toBe(`https://${GATEWAY}`);
  });
});

describe("live-chat credentials without provider (domain-based routing)", () => {
  // src/sse/services/auth.js returns credentials with NO top-level provider.
  // Routing must key off the enterprise domain, not the site derived from a
  // missing provider (which falls back to intl and would hit the web host).
  const liveCreds = () => ({
    accessToken: "dt-live",
    providerSpecificData: { enterpriseHost: ENT_HOST, userId: "u-live" },
  });

  it("exchanges an enterprise PAT on openapi even without a provider", async () => {
    const calls = [];
    globalThis.__stubFetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes("/jobToken/exchange")) {
        return { ok: true, status: 200, json: async () => ({ token: "jt-live", expires_in: 86400000 }) };
      }
      return { ok: true, status: 200, json: async () => ({ id: "u-live" }) };
    };
    const resolved = await resolveQoderCredentials({
      apiKey: "pt-live-chat",
      providerSpecificData: { enterpriseHost: ENT_HOST },
    });
    expect(resolved.accessToken).toBe("jt-live");
    expect(calls[0]).toBe(`https://${OPENAPI}/api/v1/jobToken/exchange`);
    expect(calls[1]).toBe(`https://${OPENAPI}/api/v1/userinfo`);
  });

  it("routes chat to the gateway host even against the intl fallback site", () => {
    const creds = liveCreds();
    expect(qoderInferenceBaseForSite(creds, qoderSiteOf(undefined))).toBe(`https://${GATEWAY}`);
    const executor = new QoderExecutor("qoder-cn");
    expect(executor.buildUrl(creds).startsWith(`https://${GATEWAY}/algo/`)).toBe(true);
  });

  it("routes model-list to the gateway host without a provider", async () => {
    const calls = [];
    globalThis.__stubFetch = async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({ chat: [{ key: "ultimate", display_name: "Ultimate", max_input_tokens: 131072 }] }),
      };
    };
    await fetchQoderCatalogRaw(liveCreds(), null, null, "cn", qoderSiteOf(undefined));
    expect(calls[0].startsWith(`https://${GATEWAY}/algo/api/v2/model/list`)).toBe(true);
    expect(calls[0]).not.toContain("gateway.qoder.com.cn");
  });
});

describe("VPC namespace enforcement", () => {
  it("only accepts the qoder VPC namespace with an instance label", () => {
    expect(isQoderVpcHost(ENT_HOST)).toBe(true);
    expect(isQoderVpcHost("acme.vpc.qwenwork.cn")).toBe(false);
    expect(isQoderVpcHost("evil.com")).toBe(false);
    expect(isQoderVpcHost("acme.vpc.qoder.com.cn.evil.com")).toBe(false);
    expect(isQoderVpcHost("vpc.qoder.com.cn")).toBe(false);
  });

  it("qoderVpcHosts refuses non-namespace hosts so credentials never route there", () => {
    expect(qoderVpcHosts("acme.vpc.qwenwork.cn")).toBeNull();
    expect(qoderVpcHosts("evil.com")).toBeNull();
    expect(qoderVpcHosts("acme.vpc.qoder.com.cn.evil.com")).toBeNull();
  });

  it("login rejects a domain outside the qoder VPC namespace", async () => {
    await expect(
      qoderCnProvider.requestDeviceCode(qoderCnProvider.config, undefined, { enterpriseDomain: "acme.vpc.qwenwork.cn" }),
    ).rejects.toThrow(/企业接入域名/);
  });
});

describe("quota selection via the usage dispatcher", () => {
  it("reads enterprise quota from openapi without an injected URL", async () => {
    const calls = [];
    globalThis.__stubFetch = async (url) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ userQuota: { total: 3000, used: 100, remaining: 2900 } }) };
    };
    const r = await getUsageForProvider({
      provider: "qoder-cn",
      authType: "oauth",
      accessToken: "dt-ent",
      providerSpecificData: { enterpriseHost: ENT_HOST, userId: "u-ent" },
    });
    expect(r.quotas.user.total).toBe(3000);
    expect(calls).toContain(`https://${OPENAPI}/api/v2/quota/usage`);
    expect(calls.every((u) => !u.includes("openapi.qoder.com.cn"))).toBe(true);
  });
});

describe("upload destination", () => {
  it("uploads image bytes to the enterprise gateway host (no provider)", async () => {
    const calls = [];
    globalThis.__stubFetch = async (url) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ result: { imageUrls: ["https://oss.example/img.png"] } }) };
    };
    const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const messages = [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } }] }];
    const stats = await rewriteQoderMessageAttachments(messages, {
      credentials: { accessToken: "dt-live", providerSpecificData: { enterpriseHost: ENT_HOST, userId: "u" } },
      site: null,
    });
    expect(stats.uploaded).toBe(1);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].startsWith(`https://${GATEWAY}/algo/`)).toBe(true);
    expect(calls[0]).not.toContain("gateway.qoder.com.cn");
  });
});

describe("enterprise VPC quota shape (orgResourcePackage.cap, no userQuota)", () => {
  // Real szhq-openapi.vpc.qoder.com.cn/api/v2/quota/usage response: the
  // enterprise grant lives in orgResourcePackage with a `cap` (no `total`),
  // and there is no userQuota block at all.
  const VPC_BODY = {
    userType: "enterprise",
    totalUsagePercentage: 0.0,
    isQuotaExceeded: false,
    expiresAt: 1798387200000,
    orgResourcePackage: { used: 0.0, remaining: 3000.0, percentage: 0.01, unit: "credits", cap: 3000.0, available: true },
  };

  it("reads the org package cap as total (not a 0/0 bucket)", async () => {
    globalThis.__stubFetch = async () => ({ ok: true, status: 200, json: async () => VPC_BODY });
    const r = await getQoderUsage("dt-ent", null, "qoder-cn", `https://${OPENAPI}/api/v2/quota/usage`);
    expect(r.quotas.organization.total).toBe(3000);
    expect(r.quotas.organization.used).toBe(0);
    expect(r.quotas.user.total).toBe(0);
    expect(r.quotas.organization.resetAt).toBe(new Date(1798387200000).toISOString());
  });

  it("renders one Organization row at 100% remaining, no empty Personal row", async () => {
    globalThis.__stubFetch = async () => ({ ok: true, status: 200, json: async () => VPC_BODY });
    const r = await getQoderUsage("dt-ent", null, "qoder-cn", `https://${OPENAPI}/api/v2/quota/usage`);
    const rows = parseQuotaData("qoder-cn", r);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Organization");
    expect(rows[0].total).toBe(3000);
    expect(getRemainingPercentage(rows[0])).toBe(100);
  });

  it("public cloud userQuota.total still renders a Personal row (cap fallback is additive)", () => {
    const rows = parseQuotaData("qoder-cn", {
      quotas: { user: { total: 2200, used: 200, remaining: 2000, unit: "credits", resetAt: null, neverExpires: false } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Personal");
    expect(getRemainingPercentage(rows[0])).toBe(91);
  });
});

describe("server-side namespace enforcement (fail closed)", () => {
  it("qoderEnterpriseHostError: absent/valid ⇒ null, invalid ⇒ error", () => {
    expect(qoderEnterpriseHostError("")).toBeNull();
    expect(qoderEnterpriseHostError(undefined)).toBeNull();
    expect(qoderEnterpriseHostError(ENT_HOST)).toBeNull();
    expect(qoderEnterpriseHostError(`https://${ENT_HOST}`)).toBeNull();
    expect(qoderEnterpriseHostError("evil.com")).toBe(QODER_VPC_DOMAIN_ERROR);
    expect(qoderEnterpriseHostError("acme.vpc.qwenwork.cn")).toBe(QODER_VPC_DOMAIN_ERROR);
    expect(qoderEnterpriseHostError("a.b.vpc.qoder.com.cn")).toBe(QODER_VPC_DOMAIN_ERROR);
  });

  it("validateQoderVpcDomain normalizes https:// and rejects out-of-namespace", () => {
    expect(validateQoderVpcDomain(`https://${ENT_HOST}`)).toBe(ENT_HOST);
    expect(validateQoderVpcDomain("evil.com")).toBeNull();
    expect(validateQoderVpcDomain(`http://${ENT_HOST}`)).toBeNull();
  });

  it("isQoderVpcHost rejects nested instance labels", () => {
    expect(isQoderVpcHost("a.b.vpc.qoder.com.cn")).toBe(false);
  });

  it("qoderEnterpriseServiceBase throws for a Qoder credential pointed outside the namespace", () => {
    const site = qoderSiteOf("qoder-cn");
    for (const host of ["evil.com", "acme.vpc.qwenwork.cn", `https://${ENT_HOST}`]) {
      const creds = { providerSpecificData: { enterpriseHost: host } };
      expect(() => qoderEnterpriseServiceBase(creds, site, "openapi")).toThrow(/VPC domain/);
    }
  });

  it("resolveQoderCredentials fails closed before exchanging a PAT on an invalid host (no network)", async () => {
    globalThis.__stubFetch = async () => {
      throw new Error("network must not be touched for an invalid enterprise host");
    };
    await expect(
      resolveQoderCredentials({ apiKey: "pt-invalid-host", providerSpecificData: { enterpriseHost: "evil.com" } }),
    ).rejects.toThrow(/VPC domain/);
  });

  it("QwenWork enterprise keeps a single host even for a qoder-suffix hostname (R7)", () => {
    const site = qoderSiteOf("qwenwork-enterprise");
    const creds = { providerSpecificData: { enterpriseHost: "acme.vpc.qoder.com.cn" } };
    expect(qoderEnterpriseServiceBase(creds, site, "gateway")).toBe("https://acme.vpc.qoder.com.cn");
    expect(qoderEnterpriseServiceBase(creds, site, "openapi")).toBe("https://acme.vpc.qoder.com.cn");
  });
});

describe("server-side namespace enforcement — non-string hosts & PAT capability", () => {
  it("qoderEnterpriseHostError rejects non-string enterpriseHost", () => {
    expect(qoderEnterpriseHostError([ENT_HOST])).toBe(QODER_VPC_DOMAIN_ERROR);
    expect(qoderEnterpriseHostError(123)).toBe(QODER_VPC_DOMAIN_ERROR);
    expect(qoderEnterpriseHostError({ host: ENT_HOST })).toBe(QODER_VPC_DOMAIN_ERROR);
    expect(qoderEnterpriseHostError(null)).toBeNull();
  });

  it("qoderEnterpriseServiceBase fails closed for an array host (no public fallback)", () => {
    const site = qoderSiteOf("qoder-cn");
    const creds = { providerSpecificData: { enterpriseHost: [ENT_HOST] } };
    expect(() => qoderEnterpriseServiceBase(creds, site, "openapi")).toThrow(/VPC domain/);
  });

  it("resolveQoderCredentials fails closed for an array host before any network", async () => {
    globalThis.__stubFetch = async () => {
      throw new Error("network must not be touched for a non-string enterprise host");
    };
    await expect(
      resolveQoderCredentials({ apiKey: "pt-array-host", providerSpecificData: { enterpriseHost: [ENT_HOST] } }),
    ).rejects.toThrow(/VPC domain/);
  });

  it("resolveQoderCredentials refuses a PAT for a non-PAT site (qwenwork)", async () => {
    globalThis.__stubFetch = async () => {
      throw new Error("network must not be touched for an unsupported PAT");
    };
    await expect(
      resolveQoderCredentials({ provider: "qwenwork", apiKey: "pt-not-supported" }),
    ).rejects.toThrow(/personal access tokens/);
  });
});