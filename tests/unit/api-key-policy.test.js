import { describe, expect, it, vi, beforeEach } from "vitest";
import { modelPatternMatches } from "../../src/shared/utils/modelPermissions.js";

function validateDailyLimit(payload) {
  const { maxRequestsPerDay, maxSpendUsdPerDay } = payload;
  if (maxRequestsPerDay != null && maxSpendUsdPerDay != null) {
    return { valid: false, error: "API key cannot have both request limit and spend limit. Choose one." };
  }
  return { valid: true };
}

function normalizeLimitPayload(payload) {
  const { maxRequestsPerDay, maxSpendUsdPerDay, ...rest } = payload;
  if (maxRequestsPerDay != null && maxSpendUsdPerDay != null) {
    return { error: "API key cannot have both request limit and spend limit. Choose one." };
  }
  return { maxRequestsPerDay: maxRequestsPerDay ?? null, maxSpendUsdPerDay: maxSpendUsdPerDay ?? null, ...rest };
}

const mocks = vi.hoisted(() => ({
  getApiKeyMetadata: vi.fn(),
  getDailyUsageForApiKey: vi.fn(),
  touchApiKey: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeyMetadata: mocks.getApiKeyMetadata,
  touchApiKey: mocks.touchApiKey,
}));

vi.mock("@/lib/db/repos/usageRepo", () => ({
  getDailyUsageForApiKey: mocks.getDailyUsageForApiKey,
}));

// ---------------------------------------------------------------------------
// modelPermissions (pure, no DB)
// ---------------------------------------------------------------------------
describe("modelPatternMatches", () => {
  it("matches exact model ID", () => {
    expect(modelPatternMatches("kr/claude-sonnet-4.5", ["kr/claude-sonnet-4.5"])).toBe(true);
    expect(modelPatternMatches("kr/claude-sonnet-4.5", ["kr/claude-haiku-4.5"])).toBe(false);
  });

  it("matches prefix wildcard provider/*", () => {
    expect(modelPatternMatches("openai/*", ["openai/gpt-5.5", "openai/gpt-4o", "glm/glm-5"])).toBe(true);
    expect(modelPatternMatches("openai/*", ["glm/glm-5"])).toBe(false);
  });

  it("matches glob wildcard within a segment", () => {
    expect(modelPatternMatches("claude-sonnet*", ["claude-sonnet-4.5", "claude-sonnet-4.6"])).toBe(true);
    expect(modelPatternMatches("claude-sonnet*", ["claude-opus-4-6"])).toBe(false);
  });

  it("returns false for empty candidates", () => {
    expect(modelPatternMatches("openai/*", [])).toBe(false);
  });

  it("empty allowedModels means unrestricted — caller treats empty list as pass-all", () => {
    expect(modelPatternMatches("anything", [])).toBe(false);
  });
});

describe("isModelAllowedForKey", () => {
  let isModelAllowedForKey;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.getApiKeyMetadata.mockResolvedValue(null);

    const auth = await import("../../src/sse/services/auth.js");
    isModelAllowedForKey = auth.isModelAllowedForKey;
  });

  it("allows all models when no apiKey is provided", async () => {
    expect(await isModelAllowedForKey(null, "kr/claude-sonnet-4.5")).toBe(true);
    expect(await isModelAllowedForKey(undefined, "kr/claude-sonnet-4.5")).toBe(true);
    expect(await isModelAllowedForKey("", "kr/claude-sonnet-4.5")).toBe(true);
  });

  it("allows all models when no modelId is provided", async () => {
    expect(await isModelAllowedForKey("sk-test", null)).toBe(true);
    expect(await isModelAllowedForKey("sk-test", undefined)).toBe(true);
    expect(await isModelAllowedForKey("sk-test", "")).toBe(true);
  });

  it("allows all models when key has no metadata", async () => {
    mocks.getApiKeyMetadata.mockResolvedValue(null);
    expect(await isModelAllowedForKey("sk-test", "kr/claude-sonnet-4.5")).toBe(true);
  });

  it("allows all models when allowedModels is empty array", async () => {
    mocks.getApiKeyMetadata.mockResolvedValue({ allowedModels: [] });
    expect(await isModelAllowedForKey("sk-test", "kr/claude-sonnet-4.5")).toBe(true);
  });

  it("allows all models when allowedModels is not defined", async () => {
    mocks.getApiKeyMetadata.mockResolvedValue({});
    expect(await isModelAllowedForKey("sk-test", "kr/claude-sonnet-4.5")).toBe(true);
  });

  it("blocks model not in allowedModels list", async () => {
    mocks.getApiKeyMetadata.mockResolvedValue({
      allowedModels: ["openai/gpt-5.5", "glm/glm-5"],
    });
    expect(await isModelAllowedForKey("sk-test", "kr/claude-sonnet-4.5")).toBe(false);
  });

  it("allows model exactly matching an allowedModels entry", async () => {
    mocks.getApiKeyMetadata.mockResolvedValue({
      allowedModels: ["openai/gpt-5.5", "kr/claude-sonnet-4.5"],
    });
    expect(await isModelAllowedForKey("sk-test", "kr/claude-sonnet-4.5")).toBe(true);
  });

  it("allows model matching wildcard pattern", async () => {
    mocks.getApiKeyMetadata.mockResolvedValue({
      allowedModels: ["kr/*"],
    });
    expect(await isModelAllowedForKey("sk-test", "kr/claude-sonnet-4.5")).toBe(true);
    expect(await isModelAllowedForKey("sk-test", "kr/claude-haiku-4.5")).toBe(true);
    expect(await isModelAllowedForKey("sk-test", "kr/glm-5")).toBe(true);
    expect(await isModelAllowedForKey("sk-test", "openai/gpt-5.5")).toBe(false);
  });

  it("allows model matching glob wildcard pattern", async () => {
    mocks.getApiKeyMetadata.mockResolvedValue({
      allowedModels: ["claude-sonnet*"],
    });
    expect(await isModelAllowedForKey("sk-test", "claude-sonnet-4.5")).toBe(true);
    expect(await isModelAllowedForKey("sk-test", "claude-sonnet-4.6")).toBe(true);
    expect(await isModelAllowedForKey("sk-test", "claude-opus-4-6")).toBe(false);
  });

  it("allows model if ANY pattern matches", async () => {
    mocks.getApiKeyMetadata.mockResolvedValue({
      allowedModels: ["openai/*", "kr/claude-sonnet-4.5", "glm/*"],
    });
    expect(await isModelAllowedForKey("sk-test", "kr/claude-sonnet-4.5")).toBe(true);
    expect(await isModelAllowedForKey("sk-test", "openai/gpt-5.5")).toBe(true);
    expect(await isModelAllowedForKey("sk-test", "glm/glm-5")).toBe(true);
    expect(await isModelAllowedForKey("sk-test", "minimax/MiniMax-M2.7")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getApiKeyPolicyError (auth.js — uses DB mocks)
// ---------------------------------------------------------------------------
describe("getApiKeyPolicyError", () => {
  let getApiKeyPolicyError, isModelAllowedForKey, checkDailyLimit, isKeyExpired;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.touchApiKey.mockResolvedValue(undefined);

    const auth = await import("../../src/sse/services/auth.js");
    getApiKeyPolicyError = auth.getApiKeyPolicyError;
    isModelAllowedForKey = auth.isModelAllowedForKey;
    checkDailyLimit = auth.checkDailyLimit;
    isKeyExpired = auth.isKeyExpired;
  });

  it("returns null when apiKey is empty (local mode)", async () => {
    expect(await getApiKeyPolicyError(null, "kr/claude-sonnet-4.5")).toBeNull();
    expect(await getApiKeyPolicyError(undefined, "kr/claude-sonnet-4.5")).toBeNull();
    expect(await getApiKeyPolicyError("", "kr/claude-sonnet-4.5")).toBeNull();
  });

  it("returns 401 when key is expired", async () => {
    mocks.getApiKeyMetadata.mockResolvedValue({
      expiresAt: "2020-01-01T00:00:00.000Z",
      allowedModels: [],
      blockedModels: [],
      maxRequestsPerDay: null,
      maxSpendUsdPerDay: null,
    });

    const err = await getApiKeyPolicyError("sk-test", "kr/claude-sonnet-4.5");
    expect(err).toEqual({ status: 401, message: "API key has expired" });
  });

  it("returns 403 when model is not allowed", async () => {
    mocks.getApiKeyMetadata.mockResolvedValue({
      expiresAt: null,
      allowedModels: ["openai/*"],
      blockedModels: [],
      maxRequestsPerDay: null,
      maxSpendUsdPerDay: null,
    });

    const err = await getApiKeyPolicyError("sk-test", "kr/claude-sonnet-4.5");
    expect(err).toEqual({ status: 403, message: "API key lacks permission for model: kr/claude-sonnet-4.5" });
  });

  it("returns 429 when daily request limit exceeded", async () => {
    mocks.getApiKeyMetadata.mockResolvedValue({
      expiresAt: null,
      allowedModels: [],
      blockedModels: [],
      maxRequestsPerDay: 10,
      maxSpendUsdPerDay: null,
    });
    mocks.getDailyUsageForApiKey.mockResolvedValue({ requests: 15, cost: 0 });

    const err = await getApiKeyPolicyError("sk-test", "kr/claude-sonnet-4.5");
    expect(err).not.toBeNull();
    expect(err.status).toBe(429);
  });

  it("returns 429 when daily spend limit exceeded", async () => {
    mocks.getApiKeyMetadata.mockResolvedValue({
      expiresAt: null,
      allowedModels: [],
      blockedModels: [],
      maxRequestsPerDay: null,
      maxSpendUsdPerDay: 1.0,
    });
    mocks.getDailyUsageForApiKey.mockResolvedValue({ requests: 5, cost: 1.5 });

    const err = await getApiKeyPolicyError("sk-test", "kr/claude-sonnet-4.5");
    expect(err).not.toBeNull();
    expect(err.status).toBe(429);
  });

  it("returns null when all checks pass and calls touchApiKey", async () => {
    mocks.getApiKeyMetadata.mockResolvedValue({
      expiresAt: null,
      allowedModels: [],
      blockedModels: [],
      maxRequestsPerDay: null,
      maxSpendUsdPerDay: null,
    });
    mocks.getDailyUsageForApiKey.mockResolvedValue({ requests: 0, cost: 0 });

    const err = await getApiKeyPolicyError("sk-test", "kr/claude-sonnet-4.5");
    expect(err).toBeNull();
    expect(mocks.touchApiKey).toHaveBeenCalledWith("sk-test");
  });

  it("returns null when within limits", async () => {
    mocks.getApiKeyMetadata.mockResolvedValue({
      expiresAt: null,
      allowedModels: [],
      blockedModels: [],
      maxRequestsPerDay: 100,
      maxSpendUsdPerDay: 5.0,
    });
    mocks.getDailyUsageForApiKey.mockResolvedValue({ requests: 50, cost: 2.5 });

    const err = await getApiKeyPolicyError("sk-test", "kr/claude-sonnet-4.5");
    expect(err).toBeNull();
  });

  it("checks expiry before model scope", async () => {
    mocks.getApiKeyMetadata.mockResolvedValue({
      expiresAt: "2020-01-01T00:00:00.000Z",
      allowedModels: ["openai/*"],
      blockedModels: [],
      maxRequestsPerDay: null,
      maxSpendUsdPerDay: null,
    });

    const err = await getApiKeyPolicyError("sk-test", "openai/gpt-5.5");
    expect(err.status).toBe(401);
  });
});

describe("validateDailyLimit", () => {
  it("allows payload when both maxRequestsPerDay and maxSpendUsdPerDay are null", () => {
    const res = validateDailyLimit({ maxRequestsPerDay: null, maxSpendUsdPerDay: null });
    expect(res.valid).toBe(true);
  });

  it("allows payload when only maxRequestsPerDay is present", () => {
    const res = validateDailyLimit({ maxRequestsPerDay: 100, maxSpendUsdPerDay: null });
    expect(res.valid).toBe(true);
  });

  it("allows payload when only maxSpendUsdPerDay is present", () => {
    const res = validateDailyLimit({ maxRequestsPerDay: null, maxSpendUsdPerDay: 5.5 });
    expect(res.valid).toBe(true);
  });

  it("rejects payload when both maxRequestsPerDay and maxSpendUsdPerDay are present", () => {
    const res = validateDailyLimit({ maxRequestsPerDay: 100, maxSpendUsdPerDay: 5.5 });
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/cannot have both request limit and spend limit/i);
  });
});
