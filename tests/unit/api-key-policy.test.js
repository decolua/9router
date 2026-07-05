import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getApiKeyByKey: vi.fn(),
  getApiKeyUsageTotals: vi.fn(),
  extractApiKey: vi.fn(),
  errorResponse: vi.fn((status, msg) => ({ status, body: { error: { message: msg } } })),
  logWarn: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeyByKey: mocks.getApiKeyByKey,
  getApiKeyUsageTotals: mocks.getApiKeyUsageTotals,
}));

vi.mock("@/sse/services/auth.js", () => ({
  extractApiKey: mocks.extractApiKey,
}));

vi.mock("open-sse/utils/error.js", () => ({
  errorResponse: mocks.errorResponse,
}));

vi.mock("open-sse/config/runtimeConfig.js", () => ({
  HTTP_STATUS: { FORBIDDEN: 403, RATE_LIMITED: 429 },
}));

vi.mock("@/sse/utils/logger.js", () => ({
  warn: mocks.logWarn,
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  request: vi.fn(),
  maskKey: vi.fn((k) => k),
}));

const { isModelAllowed, enforceApiKeyModelPolicy } = await import(
  "../../src/sse/services/apiKeyPolicy.js"
);

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeRequest(authHeader = null, cliToken = null) {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", `Bearer ${authHeader}`);
  if (cliToken) headers.set("x-9r-cli-token", cliToken);
  return { headers };
}

// ─── isModelAllowed (pure function) ────────────────────────────────────────

describe("isModelAllowed", () => {
  it("allows all when policy is null", () => {
    expect(isModelAllowed(null, "openai/gpt-4o")).toBe(true);
  });

  it("allows all when allowedModels is empty", () => {
    expect(isModelAllowed({ allowedModels: [] }, "openai/gpt-4o")).toBe(true);
  });

  it("allows all when allowedModels is undefined", () => {
    expect(isModelAllowed({ allowedModels: undefined }, "openai/gpt-4o")).toBe(true);
  });

  it("allows exact match", () => {
    expect(isModelAllowed({ allowedModels: ["openai/gpt-4o"] }, "openai/gpt-4o")).toBe(true);
  });

  it("allows combo name exact match", () => {
    expect(isModelAllowed({ allowedModels: ["cheap-coding"] }, "cheap-coding")).toBe(true);
  });

  it("allows alias exact match", () => {
    expect(isModelAllowed({ allowedModels: ["kr/claude-sonnet-4.5"] }, "kr/claude-sonnet-4.5")).toBe(true);
  });

  it("rejects model not in list", () => {
    expect(isModelAllowed({ allowedModels: ["openai/gpt-4o"] }, "openai/gpt-5")).toBe(false);
  });

  it("rejects when list has different models", () => {
    expect(
      isModelAllowed(
        { allowedModels: ["openai/gpt-4o", "anthropic/claude-sonnet-4.5"] },
        "openai/o3"
      )
    ).toBe(false);
  });

  it("does not match partial provider prefix", () => {
    expect(isModelAllowed({ allowedModels: ["openai/gpt-4o"] }, "openai/gpt-4o-mini")).toBe(false);
  });
});

// ─── enforceApiKeyModelPolicy (async, with mocks) ──────────────────────────

describe("enforceApiKeyModelPolicy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.extractApiKey.mockReturnValue(null);
    mocks.getApiKeyByKey.mockResolvedValue(null);
    mocks.getApiKeyUsageTotals.mockResolvedValue({ totalTokens: 0, totalCost: 0, totalRequests: 0 });
    mocks.errorResponse.mockReturnValue({ status: 403, body: { error: { message: "blocked" } } });
  });

  it("returns null (allow) when no API key in request", async () => {
    mocks.extractApiKey.mockReturnValue(null);
    const result = await enforceApiKeyModelPolicy(makeRequest(null), "openai/gpt-4o");
    expect(result).toBe(null);
    expect(mocks.getApiKeyByKey).not.toHaveBeenCalled();
  });

  it("returns null (allow) when key not found in DB", async () => {
    mocks.extractApiKey.mockReturnValue("sk-test");
    mocks.getApiKeyByKey.mockResolvedValue(null);
    const result = await enforceApiKeyModelPolicy(makeRequest("sk-test"), "openai/gpt-4o");
    expect(result).toBe(null);
  });

  it("returns null (allow) when key is inactive", async () => {
    mocks.extractApiKey.mockReturnValue("sk-test");
    mocks.getApiKeyByKey.mockResolvedValue({ id: "1", name: "test", isActive: false, policy: {} });
    const result = await enforceApiKeyModelPolicy(makeRequest("sk-test"), "openai/gpt-4o");
    expect(result).toBe(null);
  });

  it("returns null (allow) when policy has empty allowedModels", async () => {
    mocks.extractApiKey.mockReturnValue("sk-test");
    mocks.getApiKeyByKey.mockResolvedValue({
      id: "1", name: "test", isActive: true, policy: { allowedModels: [] },
    });
    const result = await enforceApiKeyModelPolicy(makeRequest("sk-test"), "openai/gpt-4o");
    expect(result).toBe(null);
  });

  it("returns null (allow) when model is in allowlist", async () => {
    mocks.extractApiKey.mockReturnValue("sk-test");
    mocks.getApiKeyByKey.mockResolvedValue({
      id: "1", name: "test", isActive: true,
      policy: { allowedModels: ["openai/gpt-4o"], maxTokens: null, maxCostUsd: null },
    });
    const result = await enforceApiKeyModelPolicy(makeRequest("sk-test"), "openai/gpt-4o");
    expect(result).toBe(null);
  });

  it("returns 403 error when model not in allowlist", async () => {
    mocks.extractApiKey.mockReturnValue("sk-test");
    mocks.getApiKeyByKey.mockResolvedValue({
      id: "1", name: "test", isActive: true,
      policy: { allowedModels: ["openai/gpt-4o"], maxTokens: null, maxCostUsd: null },
    });
    const result = await enforceApiKeyModelPolicy(makeRequest("sk-test"), "anthropic/claude-sonnet-4.5");
    expect(result).toEqual({ status: 403, body: { error: { message: "blocked" } } });
    expect(mocks.errorResponse).toHaveBeenCalledWith(403, expect.stringContaining("anthropic/claude-sonnet-4.5"));
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it("returns null (allow) when under token limit", async () => {
    mocks.extractApiKey.mockReturnValue("sk-test");
    mocks.getApiKeyByKey.mockResolvedValue({
      id: "1", name: "test", isActive: true,
      policy: { allowedModels: [], maxTokens: 10000, maxCostUsd: null },
    });
    mocks.getApiKeyUsageTotals.mockResolvedValue({ totalTokens: 5000, totalCost: 0, totalRequests: 10 });
    const result = await enforceApiKeyModelPolicy(makeRequest("sk-test"), "openai/gpt-4o");
    expect(result).toBe(null);
  });

  it("returns 429 error when token limit exceeded", async () => {
    mocks.extractApiKey.mockReturnValue("sk-test");
    mocks.getApiKeyByKey.mockResolvedValue({
      id: "1", name: "test", isActive: true,
      policy: { allowedModels: [], maxTokens: 10000, maxCostUsd: null },
    });
    mocks.getApiKeyUsageTotals.mockResolvedValue({ totalTokens: 10000, totalCost: 0, totalRequests: 50 });
    const result = await enforceApiKeyModelPolicy(makeRequest("sk-test"), "openai/gpt-4o");
    expect(result).toEqual({ status: 403, body: { error: { message: "blocked" } } });
    expect(mocks.errorResponse).toHaveBeenCalledWith(429, expect.stringContaining("token limit"));
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it("returns null (allow) when under cost limit", async () => {
    mocks.extractApiKey.mockReturnValue("sk-test");
    mocks.getApiKeyByKey.mockResolvedValue({
      id: "1", name: "test", isActive: true,
      policy: { allowedModels: [], maxTokens: null, maxCostUsd: 10 },
    });
    mocks.getApiKeyUsageTotals.mockResolvedValue({ totalTokens: 0, totalCost: 5.0, totalRequests: 10 });
    const result = await enforceApiKeyModelPolicy(makeRequest("sk-test"), "openai/gpt-4o");
    expect(result).toBe(null);
  });

  it("returns 429 error when cost limit exceeded", async () => {
    mocks.extractApiKey.mockReturnValue("sk-test");
    mocks.getApiKeyByKey.mockResolvedValue({
      id: "1", name: "test", isActive: true,
      policy: { allowedModels: [], maxTokens: null, maxCostUsd: 10 },
    });
    mocks.getApiKeyUsageTotals.mockResolvedValue({ totalTokens: 0, totalCost: 10.0, totalRequests: 50 });
    const result = await enforceApiKeyModelPolicy(makeRequest("sk-test"), "openai/gpt-4o");
    expect(result).toEqual({ status: 403, body: { error: { message: "blocked" } } });
    expect(mocks.errorResponse).toHaveBeenCalledWith(429, expect.stringContaining("cost limit"));
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it("returns null (allow) when maxTokens and maxCostUsd are both null", async () => {
    mocks.extractApiKey.mockReturnValue("sk-test");
    mocks.getApiKeyByKey.mockResolvedValue({
      id: "1", name: "test", isActive: true,
      policy: { allowedModels: [], maxTokens: null, maxCostUsd: null },
    });
    const result = await enforceApiKeyModelPolicy(makeRequest("sk-test"), "openai/gpt-4o");
    expect(result).toBe(null);
    expect(mocks.getApiKeyUsageTotals).not.toHaveBeenCalled();
  });

  it("checks model allowlist first, then token limit", async () => {
    mocks.extractApiKey.mockReturnValue("sk-test");
    mocks.getApiKeyByKey.mockResolvedValue({
      id: "1", name: "test", isActive: true,
      policy: { allowedModels: ["openai/gpt-4o"], maxTokens: 1, maxCostUsd: null },
    });
    mocks.getApiKeyUsageTotals.mockResolvedValue({ totalTokens: 999, totalCost: 0, totalRequests: 1 });
    // Model not allowed → should get 403, not 429
    const result = await enforceApiKeyModelPolicy(makeRequest("sk-test"), "anthropic/claude");
    expect(mocks.errorResponse).toHaveBeenCalledWith(403, expect.any(String));
    expect(mocks.errorResponse).not.toHaveBeenCalledWith(429, expect.any(String));
  });

  it("skips policy enforcement for internal dashboard requests (x-9r-cli-token)", async () => {
    mocks.extractApiKey.mockReturnValue("sk-test");
    mocks.getApiKeyByKey.mockResolvedValue({
      id: "1", name: "test", isActive: true,
      policy: { allowedModels: ["openai/gpt-4o"], maxTokens: 1, maxCostUsd: 1 },
    });
    // Even with a restrictive policy + exceeded limits, internal requests bypass
    mocks.getApiKeyUsageTotals.mockResolvedValue({ totalTokens: 9999, totalCost: 9999, totalRequests: 1 });
    const result = await enforceApiKeyModelPolicy(makeRequest("sk-test", "cli-token-abc"), "anthropic/claude");
    expect(result).toBe(null);
    expect(mocks.getApiKeyByKey).not.toHaveBeenCalled();
  });
});
