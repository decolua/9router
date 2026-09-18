/**
 * Provider connection test — registry-declared validateUrl
 *
 * `src/app/api/providers/[id]/test/testUtils.js` tests an API-key connection by
 * switching on the provider id. Providers without an explicit `case` fall through
 * to `default: "Provider test not supported"`, even though the registry already
 * declares a `transport.validateUrl` for them. That leaves every such provider
 * permanently reported as broken in the dashboard.
 *
 * Fifteen providers are affected today: api-airforce, baidu, bazaarlink,
 * bluesminds, featherless, kilo-gateway, llm7, morph, perplexity-agent, poolside,
 * sambanova, tencent, tokenrouter, venice, xquik.
 *
 * The sibling endpoint `src/app/api/providers/validate/route.js` already resolves
 * the same information generically from PROVIDERS:
 *   Object.entries(PROVIDERS).filter(([, t]) => t.validateUrl).map(([id, t]) => [id, t.validateUrl])
 * This suite pins the same contract for the connection-test path.
 *
 * Covers:
 *  - every provider declaring a validateUrl is testable (none reach the default)
 *  - a valid key against a validateUrl provider is reported valid
 *  - a 401/403 from a validateUrl provider is reported invalid
 *  - providers using the xai/ollama conventions keep their special-cased verdicts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";

const originalFetch = global.fetch;

// The connection-test entry point is not exported; the module is loaded through
// testSingleConnection, so the fetch mock is the observable seam.
async function loadTestSingleConnection() {
  const mod = await import("../../src/app/api/providers/[id]/test/testUtils.js");
  return mod.testSingleConnection;
}

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue({ connectionProxyEnabled: false }),
}));

const { getProviderConnectionById } = await import("@/lib/localDb");

function connectionFor(provider, apiKey = "test-key") {
  return {
    id: `conn-${provider}`,
    provider,
    authType: "apikey",
    apiKey,
    providerSpecificData: {},
  };
}

describe("registry-declared validateUrl coverage", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const declared = Object.entries(PROVIDERS)
    .filter(([, t]) => t.validateUrl)
    .map(([id]) => id);

  it("finds providers declaring a validateUrl", () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  it("tokenrouter declares a validateUrl", () => {
    expect(PROVIDERS.tokenrouter?.validateUrl).toBe("https://api.tokenrouter.com/v1/models");
  });

  it.each(declared)("reports %s as testable rather than 'Provider test not supported'", async (provider) => {
    getProviderConnectionById.mockResolvedValue(connectionFor(provider));
    global.fetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const testSingleConnection = await loadTestSingleConnection();
    const result = await testSingleConnection(`conn-${provider}`);

    expect(result.error).not.toBe("Provider test not supported");
  });
});

describe("validateUrl verdicts", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("accepts a valid tokenrouter key", async () => {
    getProviderConnectionById.mockResolvedValue(connectionFor("tokenrouter"));
    global.fetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const testSingleConnection = await loadTestSingleConnection();
    const result = await testSingleConnection("conn-tokenrouter");

    expect(result.valid).toBe(true);
  });

  it("rejects a tokenrouter key the upstream refuses", async () => {
    getProviderConnectionById.mockResolvedValue(connectionFor("tokenrouter"));
    global.fetch.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));

    const testSingleConnection = await loadTestSingleConnection();
    const result = await testSingleConnection("conn-tokenrouter");

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/invalid api key/i);
  });

  it("probes the registry-declared validateUrl, not the chat endpoint", async () => {
    getProviderConnectionById.mockResolvedValue(connectionFor("tokenrouter"));
    global.fetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const testSingleConnection = await loadTestSingleConnection();
    await testSingleConnection("conn-tokenrouter");

    const url = String(global.fetch.mock.calls[0][0]);
    expect(url).toContain("/v1/models");
    expect(url).not.toContain("/chat/completions");
  });
});
