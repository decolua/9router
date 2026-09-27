/**
 * Regression tests for #4268
 *
 * The Pi CLI settings route (POST /api/cli-tools/pi-settings) had two bugs:
 *
 * 1. All models were written with hardcoded contextWindow:128000 / maxTokens:16384,
 *    ignoring any richer metadata the caller supplied or the user had hand-tuned.
 *
 * 2. The entire provider block was replaced on every save, erasing extra fields and
 *    metadata for models the user did NOT select in this save operation.
 *
 * Secondary bug: GenericCliToolCard.js sends objects with snake_case keys
 * (context_window, max_tokens) while the route read camelCase only — values
 * silently fell back to the hardcoded defaults.
 *
 * Fix:
 * - normalizeModel() reads both camelCase and snake_case; falls back to existing
 *   saved metadata before falling back to the hardcoded defaults.
 * - Save merges into the existing provider block: untouched models are kept,
 *   newly selected models are added or updated.
 */

import { describe, it, expect } from "vitest";

// Replicate the normalizeModel + merge logic from the fixed route.

const DEFAULT_CONTEXT = 128000;
const DEFAULT_MAX_TOKENS = 16384;

function buildMergedProvider(existingProvider, incomingModels, baseUrl, apiKey) {
  const existingModelsMap = {};
  for (const em of existingProvider.models || []) {
    if (em?.id) existingModelsMap[em.id] = em;
  }

  function normalizeModel(m) {
    if (typeof m === "string") {
      const prev = existingModelsMap[m];
      return {
        ...(prev || {}),
        id: m,
        name: prev?.name || m,
        contextWindow: prev?.contextWindow || DEFAULT_CONTEXT,
        maxTokens: prev?.maxTokens || DEFAULT_MAX_TOKENS,
      };
    }
    const id = m.id || "provider/model-id";
    const prev = existingModelsMap[id] || {};
    const contextWindow = m.contextWindow || m.context_window || prev.contextWindow || DEFAULT_CONTEXT;
    const maxTokens = m.maxTokens || m.max_tokens || prev.maxTokens || DEFAULT_MAX_TOKENS;
    return { ...prev, id, name: m.name || m.id || prev.name || id, contextWindow, maxTokens };
  }

  const newModels = (Array.isArray(incomingModels) ? incomingModels : []).map(normalizeModel);
  const newModelIds = new Set(newModels.map((m) => m.id));
  const keptModels = (existingProvider.models || []).filter((m) => m?.id && !newModelIds.has(m.id));
  const modelList = [...keptModels, ...newModels];

  return {
    ...existingProvider,
    baseUrl,
    apiKey: apiKey || existingProvider.apiKey || "sk_9router",
    api: existingProvider.api || "openai-completions",
    models: modelList,
  };
}

// ── normalizeModel ──────────────────────────────────────────────────────────

describe("normalizeModel — Pi settings route (#4268)", () => {
  it("uses hardcoded defaults for a plain string model with no existing metadata", () => {
    const result = buildMergedProvider({}, ["gpt-4o"], "http://localhost/v1", null);
    const m = result.models.find((m) => m.id === "gpt-4o");
    expect(m.contextWindow).toBe(DEFAULT_CONTEXT);
    expect(m.maxTokens).toBe(DEFAULT_MAX_TOKENS);
  });

  it("uses existing saved metadata when a plain string is re-selected", () => {
    const existing = {
      models: [{ id: "gpt-4o", name: "GPT-4o", contextWindow: 524288, maxTokens: 65536 }]
    };
    const result = buildMergedProvider(existing, ["gpt-4o"], "http://localhost/v1", null);
    const m = result.models.find((m) => m.id === "gpt-4o");
    expect(m.contextWindow).toBe(524288);
    expect(m.maxTokens).toBe(65536);
  });

  it("reads camelCase contextWindow / maxTokens from object model", () => {
    const result = buildMergedProvider({}, [{ id: "m1", contextWindow: 200000, maxTokens: 8192 }], "http://localhost/v1", null);
    const m = result.models[0];
    expect(m.contextWindow).toBe(200000);
    expect(m.maxTokens).toBe(8192);
  });

  it("reads snake_case context_window / max_tokens from object model (GenericCliToolCard fix)", () => {
    const result = buildMergedProvider({}, [{ id: "m2", context_window: 200000, max_tokens: 8192 }], "http://localhost/v1", null);
    const m = result.models[0];
    expect(m.contextWindow).toBe(200000);
    expect(m.maxTokens).toBe(8192);
  });

  it("falls back to existing metadata when incoming object has no size fields", () => {
    const existing = {
      models: [{ id: "combo-a", contextWindow: 1048576, maxTokens: 32768 }]
    };
    const result = buildMergedProvider(existing, [{ id: "combo-a", name: "Combo A" }], "http://localhost/v1", null);
    const m = result.models.find((m) => m.id === "combo-a");
    expect(m.contextWindow).toBe(1048576);
    expect(m.maxTokens).toBe(32768);
  });
});

// ── merge (keep untouched models) ───────────────────────────────────────────

describe("provider merge — Pi settings route (#4268)", () => {
  it("keeps models not in the new selection", () => {
    const existing = {
      models: [
        { id: "old-model", contextWindow: 999000, maxTokens: 99999 },
        { id: "selected-model", contextWindow: 128000, maxTokens: 16384 }
      ]
    };
    const result = buildMergedProvider(existing, ["selected-model"], "http://localhost/v1", null);
    expect(result.models.some((m) => m.id === "old-model")).toBe(true);
    const old = result.models.find((m) => m.id === "old-model");
    // hand-tuned values must survive
    expect(old.contextWindow).toBe(999000);
    expect(old.maxTokens).toBe(99999);
  });

  it("updates a model that is re-selected with new object metadata", () => {
    const existing = {
      models: [{ id: "m3", contextWindow: 128000, maxTokens: 16384 }]
    };
    const result = buildMergedProvider(existing, [{ id: "m3", contextWindow: 200000, maxTokens: 8192 }], "http://localhost/v1", null);
    const m = result.models.find((m) => m.id === "m3");
    expect(m.contextWindow).toBe(200000);
  });

  it("preserves extra provider-level fields on merge", () => {
    const existing = { api: "openai-completions", customField: "keep-me", models: [] };
    const result = buildMergedProvider(existing, [], "http://localhost/v1", null);
    expect(result.customField).toBe("keep-me");
    expect(result.api).toBe("openai-completions");
  });

  it("preserves existing apiKey when none supplied", () => {
    const existing = { apiKey: "sk-existing", models: [] };
    const result = buildMergedProvider(existing, [], "http://localhost/v1", null);
    expect(result.apiKey).toBe("sk-existing");
  });
});