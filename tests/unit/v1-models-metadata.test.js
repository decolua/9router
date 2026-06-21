/**
 * Tests for the /v1/models metadata enrichment.
 *
 * Bead: 9r-ocmr.e2.03
 * PRD:  REQ-009, VAL-009
 *
 * Validates that:
 * - /v1/models response includes metadata for each model
 * - Baseline OpenAI-compatible fields remain present
 * - Credentials and headers are not exposed
 * - Metadata fields include limits, reasoning, tools, modalities
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB modules
vi.mock("../../src/lib/localDb.js", () => ({
  getProviderConnections: vi.fn().mockResolvedValue([]),
  getCombos: vi.fn().mockResolvedValue([]),
  getCustomModels: vi.fn().mockResolvedValue([]),
  getModelAliases: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../src/lib/disabledModelsDb.js", () => ({
  getDisabledModels: vi.fn().mockResolvedValue({}),
}));

// Use @/ alias to match the route's import path
vi.mock("@/lib/db/repos/modelOverridesRepo.js", () => ({
  getModelOverrides: vi.fn().mockResolvedValue({}),
}));

import { buildModelsList } from "../../src/app/api/v1/models/route.js";
import { getModelOverrides } from "../../src/lib/db/repos/modelOverridesRepo.js";

describe("/v1/models metadata enrichment (9r-ocmr.e2.03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getModelOverrides.mockResolvedValue({});
  });

  it("returns metadata field for models when connections exist", async () => {
    // Mock a provider connection
    const { getProviderConnections } = await import("../../src/lib/localDb.js");
    getProviderConnections.mockResolvedValue([
      {
        provider: "openai",
        isActive: true,
        apiKey: "test-key",
        providerSpecificData: {},
      },
    ]);

    const models = await buildModelsList(["llm"]);

    // Should have at least one model
    expect(models.length).toBeGreaterThan(0);

    // Each model should have the standard OpenAI fields
    for (const model of models) {
      expect(model.id).toBeDefined();
      expect(model.object).toBe("model");
      expect(model.owned_by).toBeDefined();
      // Should NOT contain credentials
      expect(model).not.toHaveProperty("apiKey");
      expect(model).not.toHaveProperty("headers");
      expect(model).not.toHaveProperty("baseURL");
    }
  });

  it("includes metadata with contextWindow and maxOutput", async () => {
    const { getProviderConnections } = await import("../../src/lib/localDb.js");
    getProviderConnections.mockResolvedValue([
      {
        provider: "openai",
        isActive: true,
        apiKey: "test-key",
        providerSpecificData: {},
      },
    ]);

    const models = await buildModelsList(["llm"]);

    // Find a known model (gpt-5 should be in the list)
    const gpt5 = models.find((m) => m.id?.includes("gpt-5"));
    if (gpt5) {
      expect(gpt5.metadata).toBeDefined();
      expect(gpt5.metadata.contextWindow).toBeGreaterThan(0);
      expect(gpt5.metadata.maxOutput).toBeGreaterThan(0);
      expect(typeof gpt5.metadata.reasoning).toBe("boolean");
      expect(typeof gpt5.metadata.tools).toBe("boolean");
    }
  });

  it("metadata reflects manual overrides from DB", async () => {
    // We need to know what outputAlias resolves to for openai.
    // Instead, we test with a provider/connection that gives us a known alias.
    const { getProviderConnections } = await import("../../src/lib/localDb.js");
    getProviderConnections.mockResolvedValue([
      {
        provider: "openai",
        isActive: true,
        apiKey: "test-key",
        providerSpecificData: { prefix: "openai" },
      },
    ]);

    // First, get the model list to find exact IDs
    const models = await buildModelsList(["llm"]);
    const gpt5 = models.find((m) => m.id?.includes("gpt-5"));
    
    if (gpt5) {
      // Extract the exact alias and modelId from the model ID
      const [alias, modelId] = gpt5.id.split("/");
      
      // Set override with the exact key format
      getModelOverrides.mockResolvedValue({
        [`${alias}|${modelId}`]: {
          contextWindow: 999_999,
          maxOutput: 123_456,
        },
      });

      // Re-run to pick up the override
      const models2 = await buildModelsList(["llm"]);
      const gpt5v2 = models2.find((m) => m.id?.includes("gpt-5"));
      
      if (gpt5v2) {
        expect(gpt5v2.metadata).toBeDefined();
        expect(gpt5v2.metadata.contextWindow).toBe(999_999);
        expect(gpt5v2.metadata.maxOutput).toBe(123_456);
      }
    }
  });

  it("does not expose credentials or auth headers in metadata", async () => {
    const { getProviderConnections } = await import("../../src/lib/localDb.js");
    getProviderConnections.mockResolvedValue([
      {
        provider: "openai",
        isActive: true,
        apiKey: "sk-secret-key-12345",
        providerSpecificData: { baseUrl: "https://api.openai.com/v1" },
      },
    ]);

    const models = await buildModelsList(["llm"]);

    for (const model of models) {
      const modelStr = JSON.stringify(model);
      expect(modelStr).not.toContain("sk-secret-key-12345");
      expect(modelStr).not.toContain("api.openai.com");
      expect(model).not.toHaveProperty("apiKey");
      expect(model).not.toHaveProperty("headers");
    }
  });

  it("baseline OpenAI-compatible fields are preserved", async () => {
    const { getProviderConnections } = await import("../../src/lib/localDb.js");
    getProviderConnections.mockResolvedValue([
      {
        provider: "openai",
        isActive: true,
        apiKey: "test-key",
        providerSpecificData: {},
      },
    ]);

    const models = await buildModelsList(["llm"]);

    for (const model of models) {
      // Required OpenAI fields
      expect(model.id).toMatch(/^[^/]+\/.+$/); // format: "alias/modelId"
      expect(model.object).toBe("model");
      expect(typeof model.owned_by).toBe("string");
    }
  });
});
