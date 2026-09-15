import { describe, it, expect, vi, beforeEach } from "vitest";
import { isModelAllowedForKey, validateApiKeyWithRules } from "@/sse/services/auth.js";
import { buildModelsList } from "@/app/api/v1/models/route.js";
import * as apiKeysRepo from "@/lib/db/repos/apiKeysRepo.js";

describe("Per-Key Model Access and Token Limit Rules", () => {
  describe("isModelAllowedForKey", () => {
    it("allows any model when allowedModels is null or empty", () => {
      expect(isModelAllowedForKey("gpt-4o", null)).toBe(true);
      expect(isModelAllowedForKey("gpt-4o", [])).toBe(true);
      expect(isModelAllowedForKey("oc/muse-spark-1.2-contributor-free", undefined)).toBe(true);
    });

    it("rejects when requestedModel is empty", () => {
      expect(isModelAllowedForKey("", ["gpt-4o"])).toBe(false);
      expect(isModelAllowedForKey(null, ["gpt-4o"])).toBe(false);
    });

    it("matches exact model name and provider-prefixed model name", () => {
      const allowed = ["gpt-4o", "oc/muse-spark-1.2-contributor-free"];
      expect(isModelAllowedForKey("gpt-4o", allowed)).toBe(true);
      expect(isModelAllowedForKey("openai/gpt-4o", allowed)).toBe(true);
      expect(isModelAllowedForKey("oc/muse-spark-1.2-contributor-free", allowed)).toBe(true);
      expect(isModelAllowedForKey("muse-spark-1.2-contributor-free", allowed)).toBe(true);
      expect(isModelAllowedForKey("claude-3-5-sonnet", allowed)).toBe(false);
    });

    it("matches wildcard provider prefix (e.g. oc/*, openai/*)", () => {
      const allowed = ["oc/*", "deepseek/*"];
      expect(isModelAllowedForKey("oc/muse-spark-1.2-contributor-free", allowed)).toBe(true);
      expect(isModelAllowedForKey("oc/any-other-model", allowed)).toBe(true);
      expect(isModelAllowedForKey("deepseek/deepseek-chat", allowed)).toBe(true);
      expect(isModelAllowedForKey("openai/gpt-4o", allowed)).toBe(false);
    });

    it("matches wildcard pattern (e.g. *claude*, *flash*)", () => {
      const allowed = ["*claude*", "*flash*"];
      expect(isModelAllowedForKey("anthropic/claude-3-5-sonnet", allowed)).toBe(true);
      expect(isModelAllowedForKey("claude-3-opus", allowed)).toBe(true);
      expect(isModelAllowedForKey("gemini-1.5-flash", allowed)).toBe(true);
      expect(isModelAllowedForKey("gpt-4o", allowed)).toBe(false);
    });

    it("matches universal wildcard *", () => {
      expect(isModelAllowedForKey("any-model-123", ["*"])).toBe(true);
    });
  });

  describe("validateApiKeyWithRules", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("returns error when API key is missing", async () => {
      const result = await validateApiKeyWithRules(null, "gpt-4o");
      expect(result.valid).toBe(false);
      expect(result.status).toBe(401);
      expect(result.error).toContain("Missing API key");
    });

    it("returns error when API key is not found in database", async () => {
      vi.spyOn(apiKeysRepo, "getApiKeyByKey").mockResolvedValue(null);
      const result = await validateApiKeyWithRules("invalid-key", "gpt-4o");
      expect(result.valid).toBe(false);
      expect(result.status).toBe(401);
      expect(result.error).toContain("Invalid API key");
    });

    it("returns error when API key is paused (isActive: false)", async () => {
      vi.spyOn(apiKeysRepo, "getApiKeyByKey").mockResolvedValue({
        id: "key-1",
        key: "test-key",
        name: "Test",
        isActive: false,
        tokenLimit: 0,
        usedTokens: 0,
        allowedModels: null,
      });

      const result = await validateApiKeyWithRules("test-key", "gpt-4o");
      expect(result.valid).toBe(false);
      expect(result.status).toBe(401);
      expect(result.error).toContain("paused");
    });

    it("returns 429 error when token quota is exceeded", async () => {
      vi.spyOn(apiKeysRepo, "getApiKeyByKey").mockResolvedValue({
        id: "key-1",
        key: "test-key",
        name: "Quota Key",
        isActive: true,
        tokenLimit: 50000,
        usedTokens: 50001,
        allowedModels: null,
      });

      const result = await validateApiKeyWithRules("test-key", "gpt-4o");
      expect(result.valid).toBe(false);
      expect(result.status).toBe(429);
      expect(result.error).toContain("Token limit exceeded");
    });

    it("returns 403 error when requested model is not in allowedModels", async () => {
      vi.spyOn(apiKeysRepo, "getApiKeyByKey").mockResolvedValue({
        id: "key-1",
        key: "test-key",
        name: "Restricted Key",
        isActive: true,
        tokenLimit: 100000,
        usedTokens: 500,
        allowedModels: ["oc/*", "gpt-4o-mini"],
      });

      const result = await validateApiKeyWithRules("test-key", "claude-3-5-sonnet");
      expect(result.valid).toBe(false);
      expect(result.status).toBe(403);
      expect(result.error).toContain("Model 'claude-3-5-sonnet' is not allowed");
    });

    it("succeeds when key is active, within token limit, and model is allowed", async () => {
      vi.spyOn(apiKeysRepo, "getApiKeyByKey").mockResolvedValue({
        id: "key-1",
        key: "test-key",
        name: "Good Key",
        isActive: true,
        tokenLimit: 100000,
        usedTokens: 500,
        allowedModels: ["oc/*", "gpt-4o"],
      });

      const result = await validateApiKeyWithRules("test-key", "oc/muse-spark-1.2-contributor-free");
      expect(result.valid).toBe(true);
      expect(result.keyRecord.name).toBe("Good Key");
    });
  });
});

describe("Provider Model List Fixes", () => {
  it("includes OpenCode no-auth models in /v1/models even when other connections exist", async () => {
    // buildModelsList for LLM kind
    const models = await buildModelsList(["llm"], { skipDynamicFetch: true });
    const ocModels = models.filter((m) => m.id.startsWith("oc/") || m.owned_by === "oc");
    expect(ocModels.length).toBeGreaterThan(0);
    expect(ocModels.some((m) => m.id.includes("muse-spark"))).toBe(true);
  });

  it("filters /v1/models by key allowedModels when Bearer token is provided", async () => {
    const { GET } = await import("@/app/api/v1/models/route.js");
    vi.spyOn(apiKeysRepo, "getApiKeyByKey").mockResolvedValue({
      id: "key-oc-only",
      key: "sk-oc-only-123",
      name: "OC Only",
      isActive: true,
      tokenLimit: 0,
      usedTokens: 0,
      allowedModels: ["oc/*"],
    });

    const req = new Request("http://localhost:20128/v1/models", {
      headers: {
        Authorization: "Bearer sk-oc-only-123",
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBeGreaterThan(0);
    // Every returned model must match oc/*
    expect(json.data.every((m) => m.id.startsWith("oc/"))).toBe(true);
  });
});
