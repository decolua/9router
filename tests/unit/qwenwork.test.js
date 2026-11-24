/**
 * Unit tests for the QwenWork provider integration (public cloud).
 *
 * QwenWork (gateway.qwenwork.cn) rides the Qoder-family site machinery:
 * the site table, cosy header parameterization, single-gateway inference
 * base, and the account-context usage handler. These lock the parts that
 * would silently route traffic to the wrong host or sign with the wrong
 * client identity if the site parameterization regressed:
 *   - site lookup + registry wiring for provider id "qwenwork"
 *   - cosy headers carry QwenWork's ClientType/IDE version while the
 *     defaults stay untouched for qoder/qoder-cn
 *   - chat + model-list URLs resolve to gateway.qwenwork.cn for any token
 *     kind (no jt/dt split there), and qoder keeps its api2/api3 split
 *   - device flow URL carries client_id + redirect_uri (qwenwork only)
 *   - usage handler parses the account-context envelope
 */

import { describe, it, expect } from "vitest";

import {
  QODER_SITES,
  qoderSiteOf,
  isQoderFamilyProvider,
  qoderInferenceBaseForSite,
} from "../../open-sse/shared/qoder/sites.js";
import { buildCosyHeaders } from "../../open-sse/shared/qoder/cosy.js";
import { QoderExecutor } from "../../open-sse/executors/qoder.js";
import { QoderService } from "../../src/lib/oauth/services/qoder.js";
import { PROVIDER_OAUTH } from "../../open-sse/providers/index.js";
import { PROVIDER_CAPABILITIES } from "../../open-sse/providers/capabilities.js";
import { getQwenworkUsage } from "../../open-sse/services/usage/qwenwork.js";

const QW_CREDS = {
  userId: "qw-user-id",
  authToken: "dt-qw-token",
  name: "QW",
  email: "qw@example.com",
  machineId: "qw-machine-id",
};

const QW_LIST_URL = "https://gateway.qwenwork.cn/algo/api/v2/model/list";

describe("qwenwork site registry", () => {
  it("registers the qwenwork site and family lookup", () => {
    expect(isQoderFamilyProvider("qwenwork")).toBe(true);
    expect(qoderSiteOf("qwenwork").id).toBe("qwenwork");
    expect(Object.keys(QODER_SITES)).toContain("qwenwork");
  });

  it("points every gateway base at gateway.qwenwork.cn", () => {
    const site = qoderSiteOf("qwenwork");
    for (const key of ["chat", "chatAlt", "openApi", "center"]) {
      expect(site.bases[key]).toBe("https://gateway.qwenwork.cn");
    }
    expect(site.bases.login).toBe("https://gateway.qwenwork.cn/device/selectAccounts");
    expect(site.pat).toBe(false);
    expect(site.usage.kind).toBe("accountContext");
    expect(site.deviceFlow.redirectUri).toBe("qwenwork-cn://");
  });

  it("keeps qoder and qoder-cn sites untouched", () => {
    expect(qoderSiteOf("qoder").id).toBe("qoder");
    expect(qoderSiteOf("qoder").bases.chat).toBe("https://api3.qoder.sh");
    expect(qoderSiteOf("qoder-cn").bases.chat).toBe("https://gateway.qoder.com.cn");
    // Unknown ids still fall back to the Qoder intl site.
    expect(qoderSiteOf("nope").id).toBe("qoder");
  });

  it("registers qwenwork in the OAuth registry and capability tables", () => {
    expect(PROVIDER_OAUTH.qwenwork?.deviceTokenUrl).toContain("gateway.qwenwork.cn");
    expect(Object.keys(PROVIDER_CAPABILITIES.qwenwork || {})).toEqual(
      expect.arrayContaining(["flash", "pro", "qwen3.8-max-preview"]),
    );
  });
});

describe("qwenwork cosy headers", () => {
  it("signs with QwenWork's client identity", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QW_LIST_URL, QW_CREDS, {
      site: qoderSiteOf("qwenwork").cosy,
    });
    // QwenWork's desktop client (QwenWorkCN.app) sends these values.
    expect(headers["Cosy-Clienttype"]).toBe("6");
    expect(headers["Cosy-Version"]).toBe("1.1.59");
    // All required headers still present.
    expect(headers["Cosy-Key"]).toBeTruthy();
    expect(headers["Cosy-User"]).toBe(QW_CREDS.userId);
    expect(headers.Authorization).toMatch(/^Bearer COSY\./);
  });

  it("keeps the Qoder IDE defaults for qoder signers", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QW_LIST_URL, QW_CREDS);
    expect(headers["Cosy-Clienttype"]).toBe("5");
    expect(headers["Cosy-Version"]).toBe("1.0.0");
  });
});

describe("qwenwork URL routing", () => {
  it("serves every token kind from the single gateway host", () => {
    const site = qoderSiteOf("qwenwork");
    expect(qoderInferenceBaseForSite({ accessToken: "dt-x" }, site)).toBe("https://gateway.qwenwork.cn");
    expect(qoderInferenceBaseForSite({ apiKey: "jt-x" }, site)).toBe("https://gateway.qwenwork.cn");
  });

  it("routes the executor's chat URL to gateway.qwenwork.cn", () => {
    const executor = new QoderExecutor("qwenwork");
    const url = executor.buildUrl({ accessToken: "dt-qw-token" });
    expect(url).toMatch(/^https:\/\/gateway\.qwenwork\.cn\/algo\/api\/v2\/service\/pro\/sse\/agent_chat_generation\?/);
  });

  it("keeps qoder's api2/api3 split intact", () => {
    expect(qoderInferenceBaseForSite({ apiKey: "jt-x" }, qoderSiteOf("qoder"))).toBe("https://api2.qoder.sh");
    expect(qoderInferenceBaseForSite({ accessToken: "dt-x" }, qoderSiteOf("qoder"))).toBe("https://api3.qoder.sh");
  });

  it("routes qoder-cn through the CN gateway", () => {
    expect(qoderInferenceBaseForSite({ apiKey: "jt-x" }, qoderSiteOf("qoder-cn"))).toBe("https://gateway.qoder.com.cn");
  });
});

describe("qwenwork device flow", () => {
  const qwConfig = {
    loginUrl: "https://gateway.qwenwork.cn/device/selectAccounts",
    clientId: "e883ade2-e6e3-4d6d-adf7-f92ceff5fdcb",
    redirectUri: "qwenwork-cn://",
  };

  it("appends client_id and redirect_uri to the verification URL", () => {
    const flow = new QoderService(qwConfig).initiateDeviceFlow();
    expect(flow.verificationUriComplete).toMatch(/^https:\/\/gateway\.qwenwork\.cn\/device\/selectAccounts\?/);
    expect(flow.verificationUriComplete).toContain(`client_id=${qwConfig.clientId}`);
    expect(flow.verificationUriComplete).toContain(`redirect_uri=${encodeURIComponent("qwenwork-cn://")}`);
    expect(flow.verificationUriComplete).toContain("challenge_method=S256");
    expect(flow.verificationUriComplete).toContain(`nonce=${flow.nonce}`);
  });

  it("omits both params for the plain Qoder flow", () => {
    const flow = new QoderService({}).initiateDeviceFlow();
    expect(flow.verificationUriComplete).not.toContain("client_id");
    expect(flow.verificationUriComplete).not.toContain("redirect_uri");
  });
});

describe("qwenwork usage (account-context)", () => {
  // The handler is exercised through the module source with the network
  // dependency swapped out, matching the approach used in .scratch verification.
  it("parses plan + quota into a usage row", async () => {
    const r = await getQwenworkUsage(
      "dt-x",
      "https://gateway.qwenwork.cn/api/v1/adapter/user/account-context?include=user,plan,quota",
      { proxyFetch: mockFetchFor({ data: { plan: { name: "Pro", next_due_date: "2026-12-01" }, quota: { total: 100, used: 40, remaining: 60 } } }) },
    );
    expect(r.planName).toBe("Pro");
    expect(r.quotas.user.total).toBe(100);
    expect(r.quotas.user.used).toBe(40);
    expect(r.quotas.user.remaining).toBe(60);
    expect(r.resetAt).toBe("2026-12-01T00:00:00.000Z");
  });

  it("reports remaining-only accounts without fabricating a total", async () => {
    const r = await getQwenworkUsage("dt-x", "https://gateway.qwenwork.cn/x", {
      proxyFetch: mockFetchFor({ data: { quota: { remaining: 25 } } }),
    });
    expect(r.balance).toBe("25 credits");
    expect(r.quotas.user.remaining).toBe(25);
    expect(r.quotas.user.total).toBe(0);
  });

  it("flags exhausted accounts", async () => {
    const r = await getQwenworkUsage("dt-x", "https://gateway.qwenwork.cn/x", {
      proxyFetch: mockFetchFor({ data: { quota: { remaining: 0 } } }),
    });
    expect(r.exhausted).toBe(true);
  });
});

// Test seam: the usage handler accepts a { proxyFetch } override in
// proxyOptions so tests never touch the network.
function mockFetchFor(body) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  });
}
