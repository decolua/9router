/**
 * Integration test: full metadata override flow (9r-ocmr.e2.05)
 *
 * Verifies end-to-end: set override → resolver reads it → setup/API output uses it.
 *
 * Bead: 9r-ocmr.e2.05
 * PRD:  VAL-006..009
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";

// Mock fs/promises for setup route (it writes to a temp dir)
vi.mock("fs/promises", async () => {
  const actual = await vi.importActual("fs/promises");
  return {
    ...actual,
    mkdir: vi.fn(actual.mkdir),
    writeFile: vi.fn(actual.writeFile),
    readFile: vi.fn(actual.readFile),
    access: vi.fn(actual.access),
  };
});

vi.mock("next/server", () => ({
  NextResponse: {
    json: (data, init) => ({
      status: init?.status ?? 200,
      json: async () => data,
      headers: new Map(),
    }),
  },
}));

// Mock DB modules to return provider connections
vi.mock("../../src/lib/localDb.js", () => ({
  getProviderConnections: vi.fn().mockResolvedValue([
    {
      provider: "openai",
      isActive: true,
      apiKey: "test-key",
      providerSpecificData: {},
    },
  ]),
  getCombos: vi.fn().mockResolvedValue([]),
  getCustomModels: vi.fn().mockResolvedValue([]),
  getModelAliases: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../src/lib/disabledModelsDb.js", () => ({
  getDisabledModels: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../src/lib/db/repos/modelOverridesRepo.js", () => ({
  getModelOverrides: vi.fn().mockResolvedValue({}),
  getModelOverride: vi.fn().mockResolvedValue(null),
  setModelOverride: vi.fn().mockImplementation(async (provider, model, override) => {
    const key = `${provider}|${model}`;
    globalThis.__mockOverrides = globalThis.__mockOverrides || {};
    globalThis.__mockOverrides[key] = { ...override };
    return { key, ...override };
  }),
  deleteModelOverride: vi.fn().mockImplementation(async (provider, model) => {
    const key = `${provider}|${model}`;
    globalThis.__mockOverrides = globalThis.__mockOverrides || {};
    delete globalThis.__mockOverrides[key];
  }),
}));

import { buildModelsList } from "../../src/app/api/v1/models/route.js";
import { getModelOverrides, getModelOverride } from "../../src/lib/db/repos/modelOverridesRepo.js";
import { resolveModelMetadata } from "../../src/sse/services/modelMetadataResolver.js";

describe("Full metadata override flow (9r-ocmr.e2.05)", () => {
  beforeEach(() => {
    globalThis.__mockOverrides = {};
    vi.clearAllMocks();
    getModelOverrides.mockResolvedValue({});
    getModelOverride.mockResolvedValue(null);
  });

  it("override precedence: DB > hardcoded", async () => {
    // Mock getModelOverride (singular) to return an override
    getModelOverride.mockImplementation(async (provider, model) => {
      const key = `${provider}|${model}`;
      return globalThis.__mockOverrides[key] || null;
    });

    // Simulate an override set
    globalThis.__mockOverrides = {
      "openai|gpt-5": { contextWindow: 123_456, maxOutput: 99_999 },
    };

    // Verify resolver picks up the override
    const meta = await resolveModelMetadata("openai", "gpt-5");
    expect(meta.contextWindow).toBe(123_456);
    expect(meta.maxOutput).toBe(99_999);
  });

  it("no override: resolver returns hardcoded defaults", async () => {
    getModelOverride.mockResolvedValue(null);
    const meta = await resolveModelMetadata("openai", "gpt-5");
    // gpt-5 should have a reasonable contextWindow from hardcoded caps
    expect(meta.contextWindow).toBeGreaterThan(0);
    expect(meta.maxOutput).toBeGreaterThan(0);
    expect(typeof meta.reasoning).toBe("boolean");
  });

  it("/v1/models metadata field reflects override", async () => {
    // The route uses getModelOverrides (plural) which returns a map keyed by "alias|model"
    getModelOverrides.mockResolvedValue({
      "openai|gpt-5": { contextWindow: 999_999 },
    });
    getModelOverride.mockImplementation(async (provider, model) => {
      const key = `${provider}|${model}`;
      const allOverrides = await getModelOverrides();
      return allOverrides[key] || null;
    });

    const models = await buildModelsList(["llm"]);
    const gpt5 = models.find((m) => m.id === "openai/gpt-5");
    expect(gpt5).toBeDefined();
    expect(gpt5.metadata.contextWindow).toBe(999_999);
  });

  it("setup converter uses resolver for metadata", async () => {
    // Mock getModelOverride to return known values
    getModelOverride.mockResolvedValue({
      contextWindow: 500_000,
      maxOutput: 200_000,
      reasoning: true,
      tools: true,
      vision: true,
    });

    const { buildOpenCodeModelConfig } = await import(
      "../../src/app/api/cli-tools/opencode-settings/converter.js"
    );

    // buildOpenCodeModelConfig is async — it calls resolveModelMetadata
    const config = await buildOpenCodeModelConfig("openai", "gpt-5", "test-key");
    expect(config.limit.context).toBe(500_000);
    expect(config.limit.output).toBe(200_000);
    expect(config.reasoning).toBe(true);
    expect(config.tool_call).toBe(true);
  });

  it("credentials never leak in metadata or API responses", async () => {
    getModelOverride.mockImplementation(async (provider, model) => {
      const key = `${provider}|${model}`;
      return globalThis.__mockOverrides[key] || null;
    });
    globalThis.__mockOverrides = {
      "openai|gpt-5": { contextWindow: 100_000 },
    };

    const models = await buildModelsList(["llm"]);
    const modelStr = JSON.stringify(models);
    expect(modelStr).not.toContain("test-key");
    expect(modelStr).not.toContain("apiKey");
    expect(modelStr).not.toContain("Authorization");
  });
});
