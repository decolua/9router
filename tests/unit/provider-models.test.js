/**
 * Provider model list tests — PROVIDER_MODELS, helper functions
 *
 * Validates the provider model registry structure and helper functions.
 * Tests are written against master's model list. When PR B (expand-provider-model-lists)
 * merges, additional models will be available and test thresholds can be raised.
 *
 * Covers:
 *  - Each known provider has a non-empty model list
 *  - OpenAI provider structure and known models
 *  - Gemini provider includes current-generation models
 *  - Anthropic provider includes Claude models
 *  - Helper functions: getProviderModels, getDefaultModel, isValidModel, findModelName
 *  - Model entry structure (id and name fields)
 */

import { describe, it, expect } from "vitest";
import {
  PROVIDER_MODELS,
  getProviderModels,
  getDefaultModel,
  isValidModel,
  findModelName,
} from "../../open-sse/config/providerModels.js";

describe("PROVIDER_MODELS", () => {
  describe("structure validation", () => {
    it("is a non-empty object", () => {
      expect(typeof PROVIDER_MODELS).toBe("object");
      expect(Object.keys(PROVIDER_MODELS).length).toBeGreaterThan(0);
    });

    it("every provider has at least one model", () => {
      for (const [provider, models] of Object.entries(PROVIDER_MODELS)) {
        expect(
          Array.isArray(models),
          `${provider} should have an array of models`
        ).toBe(true);
        expect(
          models.length,
          `${provider} should have at least 1 model`
        ).toBeGreaterThanOrEqual(1);
      }
    });

    it("every model entry has id and name fields", () => {
      for (const [provider, models] of Object.entries(PROVIDER_MODELS)) {
        for (const model of models) {
          expect(
            model.id,
            `model in ${provider} missing id`
          ).toBeDefined();
          expect(
            typeof model.id,
            `model id in ${provider} should be string`
          ).toBe("string");
          expect(
            model.name,
            `model in ${provider} missing name`
          ).toBeDefined();
          expect(
            typeof model.name,
            `model name in ${provider} should be string`
          ).toBe("string");
        }
      }
    });
  });

  describe("OpenAI provider", () => {
    it("has at least 3 models", () => {
      expect(PROVIDER_MODELS.openai.length).toBeGreaterThanOrEqual(3);
    });

    it("includes GPT-4o", () => {
      const ids = PROVIDER_MODELS.openai.map((m) => m.id);
      expect(ids).toContain("gpt-4o");
    });

    it("includes a GPT-5 family model", () => {
      const ids = PROVIDER_MODELS.openai.map((m) => m.id);
      const hasGpt5 = ids.some((id) => id.startsWith("gpt-5"));
      expect(hasGpt5).toBe(true);
    });
  });

  describe("Gemini provider", () => {
    it("has at least 5 models", () => {
      expect(PROVIDER_MODELS.gemini.length).toBeGreaterThanOrEqual(5);
    });

    it("includes current-gen Gemini models", () => {
      const ids = PROVIDER_MODELS.gemini.map((m) => m.id);
      expect(ids).toContain("gemini-2.5-pro");
      expect(ids).toContain("gemini-2.5-flash");
    });
  });

  describe("Anthropic provider", () => {
    it("has at least 2 models", () => {
      expect(PROVIDER_MODELS.anthropic.length).toBeGreaterThanOrEqual(2);
    });

    it("includes Claude models", () => {
      const ids = PROVIDER_MODELS.anthropic.map((m) => m.id);
      const hasClaudeModel = ids.some((id) => id.includes("claude"));
      expect(hasClaudeModel).toBe(true);
    });
  });

  describe("OAuth providers", () => {
    const oauthProviders = ["cc", "cx", "gc", "ag", "gh"];

    for (const provider of oauthProviders) {
      it(`${provider} has at least 2 models`, () => {
        expect(
          PROVIDER_MODELS[provider],
          `${provider} should exist`
        ).toBeDefined();
        expect(PROVIDER_MODELS[provider].length).toBeGreaterThanOrEqual(2);
      });
    }
  });

  describe("API key providers exist", () => {
    const apiProviders = [
      "openai",
      "anthropic",
      "gemini",
      "deepseek",
      "groq",
      "xai",
      "mistral",
    ];

    for (const provider of apiProviders) {
      it(`${provider} provider exists with models`, () => {
        expect(PROVIDER_MODELS[provider]).toBeDefined();
        expect(PROVIDER_MODELS[provider].length).toBeGreaterThanOrEqual(1);
      });
    }
  });
});

describe("helper functions", () => {
  describe("getProviderModels", () => {
    it("returns models for known provider", () => {
      const models = getProviderModels("openai");
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    });

    it("returns empty array for unknown provider", () => {
      const models = getProviderModels("nonexistent");
      expect(models).toEqual([]);
    });
  });

  describe("getDefaultModel", () => {
    it("returns first model id for known provider", () => {
      const model = getDefaultModel("openai");
      expect(typeof model).toBe("string");
      expect(model).toBe(PROVIDER_MODELS.openai[0].id);
    });

    it("returns null for unknown provider", () => {
      expect(getDefaultModel("nonexistent")).toBeNull();
    });
  });

  describe("isValidModel", () => {
    it("returns true for valid model", () => {
      const firstModel = PROVIDER_MODELS.openai[0].id;
      expect(isValidModel("openai", firstModel)).toBe(true);
    });

    it("returns false for invalid model", () => {
      expect(isValidModel("openai", "nonexistent-model")).toBe(false);
    });

    it("returns false for unknown provider", () => {
      expect(isValidModel("nonexistent", "gpt-4o")).toBe(false);
    });

    it("returns true for any model when provider is passthrough", () => {
      const passthroughSet = new Set(["custom"]);
      expect(isValidModel("custom", "any-model", passthroughSet)).toBe(true);
    });
  });

  describe("findModelName", () => {
    it("returns display name for valid model", () => {
      const name = findModelName("openai", "gpt-4o");
      expect(name).toBe("GPT-4o");
    });

    it("returns model id when not found", () => {
      const name = findModelName("openai", "unknown-model");
      expect(name).toBe("unknown-model");
    });

    it("returns model id for unknown provider", () => {
      const name = findModelName("nonexistent", "gpt-4o");
      expect(name).toBe("gpt-4o");
    });
  });
});
