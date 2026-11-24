import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("proxyFetch TLS ECDH curve configuration", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...savedEnv };
    delete process.env.NINEROUTER_TLS_ECDH_CURVE;
    delete process.env.HTTPS_PROXY;
    delete process.env.https_proxy;
    delete process.env.HTTP_PROXY;
    delete process.env.http_proxy;
    delete process.env.ALL_PROXY;
    delete process.env.all_proxy;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    vi.doUnmock("undici");
  });

  it("defaults ecdhCurve to X25519:prime256v1:secp384r1 on Agent and ProxyAgent", async () => {
    const agentCalls = [];
    const proxyAgentCalls = [];
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true });

    vi.doMock("undici", () => ({
      Agent: class MockAgent {
        constructor(opts) { agentCalls.push(opts); }
      },
      ProxyAgent: class MockProxyAgent {
        constructor(opts) { proxyAgentCalls.push(opts); }
      },
      fetch: fetchMock,
    }));

    const { proxyAwareFetch, resetDirectDispatchersForTests } = await import("../../open-sse/utils/proxyFetch.js");
    resetDirectDispatchersForTests();

    await proxyAwareFetch("https://oidc.us-east-1.amazonaws.com/token", { method: "POST", body: "{}" });
    await proxyAwareFetch(
      "https://oidc.us-east-1.amazonaws.com/token",
      { method: "POST", body: "{}" },
      { enabled: true, url: "http://127.0.0.1:7890" }
    );

    expect(agentCalls[0].connect.ecdhCurve).toBe("X25519:prime256v1:secp384r1");
    expect(proxyAgentCalls[0].requestTls.ecdhCurve).toBe("X25519:prime256v1:secp384r1");
  });

  it("honors NINEROUTER_TLS_ECDH_CURVE override", async () => {
    process.env.NINEROUTER_TLS_ECDH_CURVE = "prime256v1";
    const agentCalls = [];
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true });

    vi.doMock("undici", () => ({
      Agent: class MockAgent {
        constructor(opts) { agentCalls.push(opts); }
      },
      ProxyAgent: class MockProxyAgent {},
      fetch: fetchMock,
    }));

    const { proxyAwareFetch, resetDirectDispatchersForTests } = await import("../../open-sse/utils/proxyFetch.js");
    resetDirectDispatchersForTests();

    await proxyAwareFetch("https://oidc.us-east-1.amazonaws.com/token", { method: "POST", body: "{}" });
    expect(agentCalls[0].connect.ecdhCurve).toBe("prime256v1");
  });
});
