import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression coverage for the generic config-driven fallback added to
// testApiKeyConnection's `default` case: re-testing a saved connection for
// any provider that isn't hand-cased in the switch (Venice AI included) used
// to always return "Provider test not supported", even though
// /api/providers/validate already accepted the same provider on first add
// via PROVIDERS[id].validateUrl.
//
// vi.mock is hoisted above all imports regardless of source position, so it
// applies file-wide; the mock only adds synthetic "fallback-test-*" entries
// (spread over the real registry) used by the second describe block below —
// the first describe block's real "venice" data passes through unchanged.
vi.mock("open-sse/config/providers.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    PROVIDERS: {
      ...actual.PROVIDERS,
      "fallback-test-noauth": { noAuth: true },
      "fallback-test-openai-models": { format: "openai", baseUrl: "https://example.test/v1/chat/completions" },
      "fallback-test-xapikey": { validateUrl: "https://example.test/v1/models", authHeader: "x-api-key" },
    },
  };
});

const { testApiKeyConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("testApiKeyConnection: generic validateUrl fallback (real registry data)", () => {
  it("Venice AI: valid key against the real registry validateUrl", async () => {
    global.fetch = vi.fn(async (url) => {
      expect(url).toBe("https://api.venice.ai/api/v1/models");
      return new Response("{}", { status: 200 });
    });

    const result = await testApiKeyConnection({ provider: "venice", apiKey: "test-key" }, null);
    expect(result).toEqual({ valid: true, error: null });
  });

  it("Venice AI: invalid key (401) is reported, not 'Provider test not supported'", async () => {
    global.fetch = vi.fn(async () => new Response("{}", { status: 401 }));

    const result = await testApiKeyConnection({ provider: "venice", apiKey: "bad-key" }, null);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid API key");
    expect(result.error).not.toBe("Provider test not supported");
  });

  it("an unknown provider with no registry entry still reports 'not supported'", async () => {
    global.fetch = vi.fn();
    const result = await testApiKeyConnection({ provider: "totally-made-up-provider", apiKey: "x" }, null);
    expect(result).toEqual({ valid: false, error: "Provider test not supported" });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("testApiKeyConnection: generic fallback branches (mocked registry)", () => {
  it("cfg.noAuth short-circuits to valid without a network call", async () => {
    global.fetch = vi.fn();
    const result = await testApiKeyConnection({ provider: "fallback-test-noauth", apiKey: "" }, null);
    expect(result).toEqual({ valid: true, error: null });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("falls back to a /models probe for a config-driven openai-format provider with no validateUrl", async () => {
    global.fetch = vi.fn(async (url) => {
      expect(url).toBe("https://example.test/v1/models");
      return new Response("{}", { status: 200 });
    });
    const result = await testApiKeyConnection({ provider: "fallback-test-openai-models", apiKey: "k" }, null);
    expect(result).toEqual({ valid: true, error: null });
  });

  it("falls back further to a chat probe when the /models probe is ambiguous (non-401/403, non-ok)", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const result = await testApiKeyConnection({ provider: "fallback-test-openai-models", apiKey: "k" }, null);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][0]).toBe("https://example.test/v1/chat/completions");
    expect(result).toEqual({ valid: true, error: null });
  });

  it("uses x-api-key auth header when the provider config declares it", async () => {
    global.fetch = vi.fn(async (url, options) => {
      expect(options.headers["x-api-key"]).toBe("k");
      expect(options.headers["Authorization"]).toBeUndefined();
      return new Response("{}", { status: 200 });
    });
    await testApiKeyConnection({ provider: "fallback-test-xapikey", apiKey: "k" }, null);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
