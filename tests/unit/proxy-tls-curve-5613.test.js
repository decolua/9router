/**
 * #5613 — AWS OIDC (Kiro IAM Identity Center / Builder ID sign-in, IdC token
 * refresh) resets a TLS handshake that offers X25519 alone, so adding a Kiro
 * account failed with "fetch failed". The default curve list keeps X25519 first
 * and adds P-256 / P-384; NINEROUTER_TLS_ECDH_CURVE still overrides it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DEFAULT_CURVES = "X25519:prime256v1:secp384r1";
const ENV_KEYS = [
  "NINEROUTER_TLS_ECDH_CURVE",
  "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy",
  "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy",
];

describe("proxyFetch TLS curve list (#5613)", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...savedEnv };
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    vi.doUnmock("undici");
  });

  function mockUndici() {
    const Agent = vi.fn(function (options) { this.options = options; });
    const ProxyAgent = vi.fn(function (options) { this.options = options; });
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true });
    vi.doMock("undici", async () => ({ ...(await vi.importActual("undici")), Agent, ProxyAgent, fetch: fetchMock }));
    return { Agent, ProxyAgent, fetchMock };
  }

  it.each([
    [undefined, DEFAULT_CURVES],
    ["X25519", "X25519"],
  ])("direct and fresh-retry dispatchers offer the curve list (override=%s)", async (override, expected) => {
    if (override) process.env.NINEROUTER_TLS_ECDH_CURVE = override;
    mockUndici();
    const { getDirectDispatcher, getFreshRetryDispatcher, resetDirectDispatchersForTests } =
      await import("../../open-sse/utils/proxyFetch.js");
    resetDirectDispatchersForTests();

    expect((await getDirectDispatcher()).options.connect.ecdhCurve).toBe(expected);
    expect((await getFreshRetryDispatcher()).options.connect.ecdhCurve).toBe(expected);
  });

  it("the proxy dispatcher offers the same default curve list", async () => {
    const { ProxyAgent, fetchMock } = mockUndici();
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

    const res = await proxyAwareFetch(
      "https://oidc.us-east-1.amazonaws.com/token",
      { method: "POST", body: "{}" },
      { enabled: true, url: "http://127.0.0.1:7890", strictProxy: true },
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ProxyAgent).toHaveBeenCalledTimes(1);
    expect(ProxyAgent.mock.calls[0][0].requestTls.ecdhCurve).toBe(DEFAULT_CURVES);
    expect(ProxyAgent.mock.calls[0][0].requestTls).not.toHaveProperty("rejectUnauthorized");
  });
});
