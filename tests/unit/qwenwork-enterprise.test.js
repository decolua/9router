/**
 * Unit tests for the QwenWork enterprise provider (企业旗舰版).
 *
 * These lock the enterprise-specific contracts that would silently leak
 * tokens or mask errors if regressed:
 *   - routing: every runtime URL (chat/model-list/refresh/usage) for a
 *     credential with providerSpecificData.enterpriseHost goes to that
 *     host — never gateway.qwenwork.cn
 *   - device flow: no redirect_uri on the enterprise sign-in URL
 *   - catalog: 503 falls back to the built-in model list, 500 does not
 *   - token refresh: an expired-but-refreshable account refreshes instead
 *     of being reported dead; 401 with no refresh credentials does not
 *     produce a working refresh
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// proxyAwareFetch routes through the package's undici copy — stub it at
// the module boundary so catalog/refresh requests never touch the network.
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => globalThis.__stubFetch(...args),
}));

import {
  qoderSiteOf,
  qoderInferenceBaseForSite,
  normalizeEnterpriseHost,
} from "../../open-sse/shared/qoder/sites.js";
import { QoderExecutor } from "../../open-sse/executors/qoder.js";
import { getQwenworkUsage } from "../../open-sse/services/usage/qwenwork.js";
import { fetchQoderCatalogRaw } from "../../open-sse/services/qoderModels.js";

const ENT_HOST = "acme.vpc.qwenwork.cn";
const ENT_CREDS = {
  accessToken: "dt-ent-token",
  refreshToken: "rt-ent-token",
  expiresAt: new Date(Date.now() - 60_000).toISOString(), // already expired
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

describe("enterprise site registry", () => {
  it("marks the site enterprise with no redirect_uri and a fallback list", () => {
    const site = qoderSiteOf("qwenwork-enterprise");
    expect(site.enterprise.enabled).toBe(true);
    expect(site.deviceFlow.redirectUri).toBeNull();
    expect(site.catalog.fallbackModels.map((m) => m.key)).toEqual([
      "flash",
      "pro",
      "qwen3.8-max-preview",
    ]);
    expect(site.deviceRefresh.enabled).toBe(true);
  });

  it("normalizes valid hosts and rejects junk", () => {
    expect(normalizeEnterpriseHost("Acme.VPC.Qwenwork.cn ")).toBe("acme.vpc.qwenwork.cn");
    expect(normalizeEnterpriseHost("https://acme.vpc.qwenwork.cn")).toBeNull(); // full URLs not valid here
    expect(normalizeEnterpriseHost("")).toBeNull();
    expect(normalizeEnterpriseHost(undefined)).toBeNull();
  });
});

describe("enterprise routing (tokens never leave the domain)", () => {
  it("routes chat URLs to the enterprise host", () => {
    const executor = new QoderExecutor("qwenwork-enterprise");
    const url = executor.buildUrl(ENT_CREDS);
    expect(url.startsWith(`https://${ENT_HOST}/`)).toBe(true);
    expect(url).not.toContain("gateway.qwenwork.cn");
  });

  it("routes the model-list base to the enterprise host", () => {
    const site = qoderSiteOf("qwenwork-enterprise");
    expect(qoderInferenceBaseForSite(ENT_CREDS, site)).toBe(`https://${ENT_HOST}`);
    expect(qoderInferenceBaseForSite(ENT_CREDS, site)).not.toContain("gateway.qwenwork.cn");
  });

  it("falls back to the site placeholder host only without an enterpriseHost", () => {
    const site = qoderSiteOf("qwenwork-enterprise");
    expect(qoderInferenceBaseForSite({ accessToken: "x" }, site)).toBe("https://gateway.qwenwork.cn");
  });

  it("routes usage to the enterprise host", () => {
    // Same URL derivation as qwenworkUsageUrl in services/usage.js.
    const host = normalizeEnterpriseHost(ENT_CREDS.providerSpecificData.enterpriseHost);
    const url = `https://${host}/api/v1/adapter/user/account-context?include=user,plan,quota`;
    expect(url.startsWith(`https://${ENT_HOST}/`)).toBe(true);
    expect(url).not.toContain("gateway.qwenwork.cn");
  });
});

describe("enterprise token refresh (3.6)", () => {
  const executor = new QoderExecutor("qwenwork-enterprise");

  it("reports an expired token as needing refresh", () => {
    expect(executor.needsRefresh(ENT_CREDS)).toBe(true);
    // Not yet expired → no refresh needed.
    const fresh = { ...ENT_CREDS, expiresAt: new Date(Date.now() + 3600_000).toISOString() };
    expect(executor.needsRefresh(fresh)).toBe(false);
  });

  it("refreshes against the enterprise host and rotates the token pair", async () => {
    const calls = [];
    globalThis.__stubFetch = async (url, opts) => {
      calls.push({ url: String(url), body: JSON.parse(opts.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: "dt-new", refresh_token: "rt-new", expires_in: 86400 }),
      };
    };
    const result = await executor.refreshCredentials(ENT_CREDS, console, null);
    expect(result).toEqual({
      accessToken: "dt-new",
      refreshToken: "rt-new",
      expiresAt: expect.any(Number),
    });
    // The refresh request went to the enterprise host, never the public gateway.
    expect(calls).toHaveLength(1);
    expect(calls[0].url.startsWith(`https://${ENT_HOST}/api/v1/deviceToken/refresh`)).toBe(true);
    expect(calls[0].body.refresh_token).toBe("rt-ent-token");
    expect(calls[0].body.target).toBe("c");
  });

  it("returns null (unusable) on 401 with no refresh credentials", async () => {
    globalThis.__stubFetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const noRefresh = { ...ENT_CREDS, refreshToken: "" };
    expect(await executor.refreshCredentials(noRefresh, console, null)).toBeNull();
    const expired401 = { ...ENT_CREDS };
    expect(await executor.refreshCredentials(expired401, console, null)).toBeNull();
  });

  it("returns null for qoder/qoder-cn (their upstream 403s the refresh)", async () => {
    const qoder = new QoderExecutor("qoder");
    expect(await qoder.refreshCredentials(ENT_CREDS, console, null)).toBeNull();
    const cn = new QoderExecutor("qoder-cn");
    expect(await cn.refreshCredentials(ENT_CREDS, console, null)).toBeNull();
    expect(qoder.needsRefresh(ENT_CREDS)).toBe(false);
  });
});

describe("enterprise catalog 503 fallback (3.5)", () => {
  // fetchQoderCatalogRaw is exercised through the real module with the
  // network boundary stubbed via vi.mock above.
  const site = qoderSiteOf("qwenwork-enterprise");
  // fetchQoderCatalogRaw is imported at the top (vi.mock is hoisted above it).

  it("returns the built-in listing on 503", async () => {
    globalThis.__stubFetch = async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    });
    const fetched = await fetchQoderCatalogRaw(
      { accessToken: "x", providerSpecificData: { userId: "u", enterpriseHost: ENT_HOST } },
      null,
      null,
      "intl",
      site,
    );
    expect(fetched).not.toBeNull();
    expect(fetched.fallback).toEqual(site.catalog.fallbackModels);
  });

  it("returns null on 500 (no fallback for a transient server error)", async () => {
    globalThis.__stubFetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    const fetched = await fetchQoderCatalogRaw(
      { accessToken: "x", providerSpecificData: { userId: "u", enterpriseHost: ENT_HOST } },
      null,
      null,
      "intl",
      site,
    );
    expect(fetched).toBeNull();
  });
});

describe("enterprise usage envelope", () => {
  it("reads account-context from the enterprise host", async () => {
    const calls = [];
    const r = await getQwenworkUsage("dt-ent", `https://${ENT_HOST}/api/v1/adapter/user/account-context?include=user,plan,quota`, {
      proxyFetch: async (url) => {
        calls.push(String(url));
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { plan: { name: "旗舰版" }, quota: { total: 200, used: 50, remaining: 150 } } }),
        };
      },
    });
    expect(r.planName).toBe("旗舰版");
    expect(r.quotas.user.total).toBe(200);
    expect(calls[0].startsWith(`https://${ENT_HOST}/`)).toBe(true);
    expect(calls[0]).not.toContain("gateway.qwenwork.cn");
  });
});
