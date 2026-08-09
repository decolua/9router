import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(),
  isValidApiKey: vi.fn(),
  checkAndRefreshToken: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
}));

vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: mocks.checkAndRefreshToken,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
}));

vi.mock("@/sse/utils/logger.js", () => ({
  warn: vi.fn(),
}));

const { CODEX_SEARCH_URL, forwardCodexSearch } = await import("../../open-sse/handlers/codexSearch.js");
const { handleCodexSearch } = await import("../../src/sse/handlers/codexSearch.js");
const nextConfig = (await import("../../next.config.mjs")).default;

function searchBody(model = "gpt-5.6-sol") {
  return {
    id: "request-id",
    model,
    input: "current OpenAI Codex web search documentation",
    commands: {
      search_query: [{ q: "current OpenAI Codex web search documentation" }],
      response_length: "short",
    },
    settings: {
      search_context_size: "medium",
      external_web_access: true,
    },
    max_output_tokens: 2000,
  };
}

function request(body = searchBody()) {
  return new Request("http://router.test/v1/alpha/search", {
    method: "POST",
    headers: {
      Authorization: "Bearer router-client-key",
      "Content-Type": "application/json",
      "User-Agent": "codex_cli_rs/0.147.0",
      originator: "codex_cli_rs",
    },
    body: JSON.stringify(body),
  });
}

function credentials(id, token) {
  return {
    accessToken: token,
    connectionId: id,
    connectionName: id,
    providerSpecificData: {
      chatgptAccountId: `${id}-account`,
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.test:8080",
    },
  };
}

describe("Codex alpha search routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: true });
    mocks.extractApiKey.mockReturnValue("router-client-key");
    mocks.isValidApiKey.mockResolvedValue(true);
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false });
    mocks.checkAndRefreshToken.mockImplementation(async (_provider, value) => value);
  });

  it("forwards the standalone search envelope with stored Codex OAuth", async () => {
    mocks.proxyAwareFetch.mockResolvedValue(new Response(JSON.stringify({ output: "answer", results: [] }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        "Content-Length": "123",
      },
    }));

    const inboundHeaders = request().headers;
    const result = await forwardCodexSearch({
      body: searchBody("cx/gpt-5.6-sol"),
      credentials: credentials("codex-one", "oauth-secret"),
      clientHeaders: inboundHeaders,
    });

    expect(result.success).toBe(true);
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, options, proxyOptions] = mocks.proxyAwareFetch.mock.calls[0];
    expect(url).toBe(CODEX_SEARCH_URL);
    expect(options.headers.Authorization).toBe("Bearer oauth-secret");
    expect(options.headers.Authorization).not.toContain("router-client-key");
    expect(options.headers["ChatGPT-Account-ID"]).toBe("codex-one-account");
    expect(options.headers["session-id"]).toBe("request-id");
    expect(JSON.parse(options.body)).toEqual(searchBody("gpt-5.6-sol"));
    expect(proxyOptions.connectionProxyUrl).toBe("http://proxy.test:8080");
    expect(result.response.headers.get("content-encoding")).toBeNull();
    expect(result.response.headers.get("content-length")).toBeNull();
  });

  it("uses the Codex account selected by 9Router and clears its stale lock", async () => {
    const selected = credentials("codex-selected", "selected-token");
    mocks.getProviderCredentials.mockResolvedValue(selected);
    mocks.proxyAwareFetch.mockResolvedValue(Response.json({ output: "ok", results: [] }));

    const response = await handleCodexSearch(request());

    expect(response.status).toBe(200);
    expect(mocks.getProviderCredentials).toHaveBeenCalledWith("codex", expect.any(Set), "gpt-5.6-sol");
    expect(mocks.checkAndRefreshToken).toHaveBeenCalledWith("codex", selected);
    expect(mocks.clearAccountError).toHaveBeenCalledWith("codex-selected", selected, "gpt-5.6-sol");
  });

  it("falls back to another Codex account after a retryable upstream error", async () => {
    const first = credentials("codex-first", "first-token");
    const second = credentials("codex-second", "second-token");
    mocks.getProviderCredentials.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    mocks.markAccountUnavailable.mockResolvedValueOnce({ shouldFallback: true });
    mocks.proxyAwareFetch
      .mockResolvedValueOnce(Response.json({ error: { message: "rate limited" } }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ output: "ok", results: [] }));

    const response = await handleCodexSearch(request());

    expect(response.status).toBe(200);
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(mocks.proxyAwareFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer first-token");
    expect(mocks.proxyAwareFetch.mock.calls[1][1].headers.Authorization).toBe("Bearer second-token");
    expect(mocks.getProviderCredentials.mock.calls[1][1]).toEqual(new Set(["codex-first"]));
  });

  it("rejects an invalid gateway key before selecting Codex credentials", async () => {
    mocks.isValidApiKey.mockResolvedValue(false);

    const response = await handleCodexSearch(request());

    expect(response.status).toBe(401);
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("does not send an OAuth token without its ChatGPT account binding", async () => {
    const result = await forwardCodexSearch({
      body: searchBody(),
      credentials: { accessToken: "oauth-secret", providerSpecificData: {} },
      clientHeaders: request().headers,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("maps the /codex compatibility path before the catch-all Responses rewrite", async () => {
    const rewrites = await nextConfig.rewrites();
    const exactIndex = rewrites.findIndex((rule) => rule.source === "/codex/alpha/search");
    const catchAllIndex = rewrites.findIndex((rule) => rule.source === "/codex/:path*");

    expect(exactIndex).toBeGreaterThanOrEqual(0);
    expect(rewrites[exactIndex].destination).toBe("/api/v1/alpha/search");
    expect(exactIndex).toBeLessThan(catchAllIndex);
  });
});
