import { describe, it, expect } from "vitest";
import { isModelAllowed, checkApiKeyModelAccess, filterAllowedModels } from "@/sse/services/modelAcl.js";
import { extractApiKey } from "@/sse/services/auth.js";

describe("Model ACL - isModelAllowed", () => {
  it("wildcard '*' permits all models", () => {
    expect(isModelAllowed("deepseek-chat", ["*"])).toBe(true);
    expect(isModelAllowed("qwen-turbo", ["*"])).toBe(true);
    expect(isModelAllowed("gpt-4o", ["*"])).toBe(true);
    expect(isModelAllowed("claude-3-7-sonnet", ["*"])).toBe(true);
    expect(isModelAllowed("custom-model-x", ["*"])).toBe(true);
  });

  it("permits exact matches (case-insensitive)", () => {
    expect(isModelAllowed("deepseek-chat", ["deepseek-chat"])).toBe(true);
    expect(isModelAllowed("DEEPSEEK-CHAT", ["deepseek-chat"])).toBe(true);
    expect(isModelAllowed("deepseek-chat", ["DEEPSEEK-CHAT"])).toBe(true);
    expect(isModelAllowed("deepseek-reasoner", ["deepseek-chat"])).toBe(false);
  });

  it("matches model family/provider prefix (e.g. 'deepseek')", () => {
    // deepseek rule
    expect(isModelAllowed("deepseek-chat", ["deepseek"])).toBe(true);
    expect(isModelAllowed("deepseek-reasoner", ["deepseek"])).toBe(true);
    expect(isModelAllowed("deepseek/deepseek-chat", ["deepseek"])).toBe(true);
    expect(isModelAllowed("deepseek-ai/deepseek-v3", ["deepseek"])).toBe(true);
    expect(isModelAllowed("deepseek_v3", ["deepseek"])).toBe(true);
    expect(isModelAllowed("qwen-plus", ["deepseek"])).toBe(false);
    expect(isModelAllowed("gpt-4o", ["deepseek"])).toBe(false);
  });

  it("matches 'qwen' family prefix", () => {
    expect(isModelAllowed("qwen-turbo", ["qwen"])).toBe(true);
    expect(isModelAllowed("qwen-plus", ["qwen"])).toBe(true);
    expect(isModelAllowed("qwen-max", ["qwen"])).toBe(true);
    expect(isModelAllowed("qwen2.5-72b-instruct", ["qwen"])).toBe(true);
    expect(isModelAllowed("qwen/qwen-plus", ["qwen"])).toBe(true);
    expect(isModelAllowed("deepseek-chat", ["qwen"])).toBe(false);
  });

  it("supports multi-model allowed list (e.g. Customer 3: deepseek + qwen)", () => {
    const customer3Rules = ["deepseek", "qwen"];
    expect(isModelAllowed("deepseek-chat", customer3Rules)).toBe(true);
    expect(isModelAllowed("deepseek-reasoner", customer3Rules)).toBe(true);
    expect(isModelAllowed("qwen-turbo", customer3Rules)).toBe(true);
    expect(isModelAllowed("qwen-plus", customer3Rules)).toBe(true);

    // Other models must be denied
    expect(isModelAllowed("gpt-4o", customer3Rules)).toBe(false);
    expect(isModelAllowed("claude-3-5-sonnet", customer3Rules)).toBe(false);
    expect(isModelAllowed("gemini-2.5-flash", customer3Rules)).toBe(false);
  });

  it("supports glob patterns (e.g. 'gpt-4*')", () => {
    expect(isModelAllowed("gpt-4o", ["gpt-4*"])).toBe(true);
    expect(isModelAllowed("gpt-4-turbo", ["gpt-4*"])).toBe(true);
    expect(isModelAllowed("gpt-4o-mini", ["gpt-4*"])).toBe(true);
    expect(isModelAllowed("gpt-3.5-turbo", ["gpt-4*"])).toBe(false);
    expect(isModelAllowed("claude-3-5-sonnet", ["gpt-4*"])).toBe(false);
  });

  it("matches models when rule has provider prefix and request does not, or vice versa", () => {
    expect(isModelAllowed("deepseek-chat", ["deepseek/deepseek-chat"])).toBe(true);
    expect(isModelAllowed("deepseek/deepseek-chat", ["deepseek-chat"])).toBe(true);
  });

  it("handles string or JSON input for allowedModels", () => {
    expect(isModelAllowed("deepseek-chat", '["deepseek"]')).toBe(true);
    expect(isModelAllowed("qwen-plus", '["deepseek"]')).toBe(false);
    expect(isModelAllowed("deepseek-chat", "deepseek, qwen")).toBe(true);
    expect(isModelAllowed("qwen-plus", "deepseek, qwen")).toBe(true);
  });

  it("rejects when model or allowedModels is empty/missing", () => {
    expect(isModelAllowed("", ["*"])).toBe(false);
    expect(isModelAllowed(null, ["*"])).toBe(false);
    expect(isModelAllowed(undefined, ["*"])).toBe(false);
    expect(isModelAllowed("deepseek-chat", [])).toBe(false);
    expect(isModelAllowed("deepseek-chat", null)).toBe(false);
  });
});

describe("Model ACL - checkApiKeyModelAccess", () => {
  it("returns 401 when API key is inactive / paused", () => {
    const key = {
      id: "key-1",
      name: "Customer Paused",
      isActive: false,
      allowedModels: ["*"]
    };
    const check = checkApiKeyModelAccess(key, "deepseek-chat");
    expect(check.allowed).toBe(false);
    expect(check.status).toBe(401);
    expect(check.error).toContain("inactive");
  });

  it("returns 401 when API key has expired", () => {
    const pastDate = new Date(Date.now() - 3600 * 1000).toISOString();
    const key = {
      id: "key-2",
      name: "Customer Expired",
      isActive: true,
      expiresAt: pastDate,
      allowedModels: ["*"]
    };
    const check = checkApiKeyModelAccess(key, "deepseek-chat");
    expect(check.allowed).toBe(false);
    expect(check.status).toBe(401);
    expect(check.error).toContain("expired");
  });

  it("returns 403 when model is not permitted by allowedModels", () => {
    const key = {
      id: "key-3",
      name: "Customer 1 - DeepSeek Only",
      isActive: true,
      allowedModels: ["deepseek"]
    };

    // Deepseek request: allowed
    const okCheck = checkApiKeyModelAccess(key, "deepseek-chat");
    expect(okCheck.allowed).toBe(true);

    // Qwen request: 403 Forbidden
    const forbiddenCheck = checkApiKeyModelAccess(key, "qwen-plus");
    expect(forbiddenCheck.allowed).toBe(false);
    expect(forbiddenCheck.status).toBe(403);
    expect(forbiddenCheck.error).toContain("not permitted");
    expect(forbiddenCheck.model).toBe("qwen-plus");
  });

  it("allows requests when key is valid and not expired", () => {
    const futureDate = new Date(Date.now() + 86400 * 1000).toISOString();
    const key = {
      id: "key-4",
      name: "Customer 3 - Multi",
      isActive: true,
      expiresAt: futureDate,
      allowedModels: ["deepseek", "qwen"]
    };

    expect(checkApiKeyModelAccess(key, "deepseek-chat").allowed).toBe(true);
    expect(checkApiKeyModelAccess(key, "qwen-turbo").allowed).toBe(true);
    expect(checkApiKeyModelAccess(key, "gpt-4o").allowed).toBe(false);
  });
});

describe("Model ACL - filterAllowedModels", () => {
  it("filters a list of models according to allowed_models rules", () => {
    const availableModels = [
      { id: "deepseek-chat", name: "DeepSeek Chat" },
      { id: "deepseek-reasoner", name: "DeepSeek R1" },
      { id: "qwen-turbo", name: "Qwen Turbo" },
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet" },
    ];

    // Customer 1: deepseek only
    const filtered1 = filterAllowedModels(availableModels, ["deepseek"]);
    expect(filtered1.map((m) => m.id)).toEqual(["deepseek-chat", "deepseek-reasoner"]);

    // Customer 2: qwen only
    const filtered2 = filterAllowedModels(availableModels, ["qwen"]);
    expect(filtered2.map((m) => m.id)).toEqual(["qwen-turbo"]);

    // Customer 3: deepseek + qwen
    const filtered3 = filterAllowedModels(availableModels, ["deepseek", "qwen"]);
    expect(filtered3.map((m) => m.id)).toEqual(["deepseek-chat", "deepseek-reasoner", "qwen-turbo"]);

    // Customer 4: all models
    const filtered4 = filterAllowedModels(availableModels, ["*"]);
    expect(filtered4.length).toBe(5);

    // Swapped argument order tolerance: filterAllowedModels(allowedModels, availableModels)
    const filteredSwapped = filterAllowedModels(["deepseek"], availableModels);
    expect(filteredSwapped.map((m) => m.id)).toEqual(["deepseek-chat", "deepseek-reasoner"]);

    // Combo models: allowed by combo name
    const comboModels = [
      { id: "Emam", object: "model", owned_by: "combo", comboModels: ["mmf/mimo-auto"] },
      { id: "OtherCombo", object: "model", owned_by: "combo", comboModels: ["oc/spark"] },
      { id: "mmf/mimo-auto", object: "model" },
    ];
    const filteredComboByName = filterAllowedModels(comboModels, ["Emam"]);
    expect(filteredComboByName.map((m) => m.id)).toEqual(["Emam"]);

    // Combo models: allowed by underlying model
    const filteredComboBySub = filterAllowedModels(comboModels, ["mmf/mimo-auto"]);
    expect(filteredComboBySub.map((m) => m.id)).toContain("Emam");
    expect(filteredComboBySub.map((m) => m.id)).toContain("mmf/mimo-auto");
    expect(filteredComboBySub.map((m) => m.id)).not.toContain("OtherCombo");
  });
});

describe("Auth - extractApiKey", () => {
  it("extracts key from Authorization: Bearer <key>", () => {
    const req = { headers: { get: (h) => h.toLowerCase() === "authorization" ? "Bearer sk-alpha-123" : null } };
    expect(extractApiKey(req)).toBe("sk-alpha-123");
  });

  it("extracts key from case-insensitive bearer header", () => {
    const req = { headers: { get: (h) => h.toLowerCase() === "authorization" ? "bearer   sk-beta-456  " : null } };
    expect(extractApiKey(req)).toBe("sk-beta-456");
  });

  it("extracts key from x-api-key or api-key header", () => {
    const req1 = { headers: { get: (h) => h.toLowerCase() === "x-api-key" ? "sk-anthropic-1" : null } };
    const req2 = { headers: { get: (h) => h.toLowerCase() === "api-key" ? "sk-azure-1" : null } };
    expect(extractApiKey(req1)).toBe("sk-anthropic-1");
    expect(extractApiKey(req2)).toBe("sk-azure-1");
  });

  it("extracts key from URL query string ?key=...", () => {
    const req = { headers: {}, url: "http://localhost:20127/v1/models?key=sk-query-token" };
    expect(extractApiKey(req)).toBe("sk-query-token");
  });

  it("returns null when no key is present", () => {
    const req = { headers: {} };
    expect(extractApiKey(req)).toBeNull();
  });
});

