import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/models", () => ({
  getModelAliases: vi.fn(async () => ({})),
  setModelAlias: vi.fn(),
  getCustomModels: vi.fn(async () => []),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));

import { GET } from "@/app/api/models/route.js";
import { getCustomModels } from "@/models";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { DEFAULT_CAPABILITIES, getCapabilitiesForModel, getCapabilitiesWithSource, setCatalogSource } from "../../open-sse/providers/capabilities.js";

beforeEach(() => vi.clearAllMocks());
afterEach(() => setCatalogSource(null));

async function customModel(row) {
  vi.mocked(getCustomModels).mockResolvedValueOnce([row]);
  const response = await GET();
  expect(response.status).toBe(200);
  const { models } = await response.json();
  return models.find((model) => model.fullModel === `${row.providerAlias}/${row.id}`);
}

describe("/api/models limit provenance", () => {
  it("distinguishes a pattern pin from a default on the same model", async () => {
    const model = await customModel({ providerAlias: "oc", id: "step-5-provenance-test" });
    expect(model.capsSource).toEqual({ contextWindow: "pattern:*step-*", maxOutput: "default" });
    const caps = getCapabilitiesForModel("opencode", "step-5-provenance-test");
    expect(model.caps).toMatchObject({ contextWindow: caps.contextWindow, maxOutput: caps.maxOutput });
  });

  it("reports synced catalog limits per field without relabeling the other limit", async () => {
    setCatalogSource({ getModalities: () => null, getLimits: () => ({ maxOutput: 45678 }) });
    const model = await customModel({ providerAlias: "oc", id: "step-5-provenance-test" });
    expect(model.capsSource).toEqual({
      contextWindow: "pattern:*step-*", maxOutput: "catalog:opencode/step-5-provenance-test",
    });
    expect(model.caps.maxOutput).toBe(45678);
  });

  it("reports persisted custom limits after the route applies its final override", async () => {
    const model = await customModel({ providerAlias: "custom-test", id: "step-5-provenance-test", caps: { contextWindow: 777777, vision: true } });
    expect(model.capsSource).toEqual({ contextWindow: "custom:custom-test/step-5-provenance-test", maxOutput: "default" });
    expect(model.caps).toMatchObject({ contextWindow: 777777, vision: true });
  });

  it("resolves provider aliases before identifying provider overrides", async () => {
    // Vendor prefix avoids shadowing an existing registry row while preserving
    // the resolver's canonical provider-specific lookup.
    const model = await customModel({ providerAlias: "ocg", id: "vendor/claude-haiku-5-5" });
    expect(model.capsSource).toEqual({ contextWindow: "override:opencode-go", maxOutput: "override:opencode-go" });
    expect(model.caps.contextWindow).toBe(1000000);
  });

  it("attributes a custom maxOutput to the persisted row even when a catalog value exists", async () => {
    setCatalogSource({ getModalities: () => null, getLimits: () => ({ maxOutput: 45678 }) });
    const model = await customModel({ providerAlias: "custom-test", id: "step-5-provenance-test", caps: { maxOutput: 33333 } });
    expect(model.capsSource).toEqual({ contextWindow: "pattern:*step-*", maxOutput: "custom:custom-test/step-5-provenance-test" });
    expect(model.caps.maxOutput).toBe(33333);
  });

  it("adds provenance to registry rows and retains existing filtering and aliases", async () => {
    vi.mocked(getDisabledModels).mockResolvedValueOnce({ ocg: ["claude-haiku-5-5"] });
    const response = await GET();
    const { models } = await response.json();
    expect(models.some((model) => model.routedModel === "ocg/claude-haiku-5-5")).toBe(false);
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(model.capsSource).toEqual({ contextWindow: expect.any(String), maxOutput: expect.any(String) });
      expect(model.routedModel).toBeDefined();
      expect(model.alias).toBeDefined();
    }
  });
});

describe("capability resolver limit provenance", () => {
  it.each([
    [null, null, "default"],
    ["test-provider", "unknown-model-for-provenance", "default"],
    ["test-provider", "vendor/claude-opus-4.6", "builtin:claude-opus-4.6"],
    ["opencode-go", "vendor/claude-haiku-5-5", "override:opencode-go"],
    ["commandcode", "unknown-model-for-provenance", "provider:commandcode"],
    ["cmc", "unknown-model-for-provenance", "provider:commandcode"],
    ["commandcode", "claude-haiku-5-5", "override:commandcode"],
  ])("identifies both limits for %s/%s", (provider, model, source) => {
    const resolved = getCapabilitiesWithSource(provider, model);
    expect(resolved.capsSource).toEqual({ contextWindow: source, maxOutput: source });
    expect(resolved.caps).toEqual(getCapabilitiesForModel(provider, model));
    expect(resolved.caps).not.toHaveProperty("capsSource");
    if (!model) expect(resolved.caps).toEqual(DEFAULT_CAPABILITIES);
  });

  it("identifies a catalog overlay even when it supplies the same numeric value", () => {
    const base = getCapabilitiesForModel("test-provider", "deepseek-v4.1-flash");
    setCatalogSource({ getModalities: () => null, getLimits: () => ({ contextWindow: base.contextWindow }) });

    expect(getCapabilitiesWithSource("test-provider", "deepseek-v4.1-flash")).toEqual({
      caps: base,
      capsSource: { contextWindow: "catalog:test-provider/deepseek-v4.1-flash", maxOutput: "builtin:deepseek-v4.1-flash" },
    });
  });

  it("keeps provider overrides ahead of catalog values", () => {
    const getLimits = vi.fn(() => ({ contextWindow: 12345, maxOutput: 6789 }));
    setCatalogSource({ getModalities: () => null, getLimits });

    const resolved = getCapabilitiesWithSource("opencode-go", "claude-haiku-5-5");
    expect(resolved.capsSource).toEqual({ contextWindow: "override:opencode-go", maxOutput: "override:opencode-go" });
    expect(resolved.caps.contextWindow).toBe(1000000);
    expect(getLimits).not.toHaveBeenCalled();
  });

  it("does not attribute rejected catalog limits or modality-only changes to the catalog", () => {
    setCatalogSource({ getModalities: () => ({ vision: true }), getLimits: () => ({ contextWindow: 0, maxOutput: -1 }) });

    const resolved = getCapabilitiesWithSource("test-provider", "unknown-model-for-provenance");
    expect(resolved.capsSource).toEqual({ contextWindow: "default", maxOutput: "default" });
    expect(resolved.caps).toMatchObject({ vision: true, contextWindow: DEFAULT_CAPABILITIES.contextWindow, maxOutput: DEFAULT_CAPABILITIES.maxOutput });
  });
});
