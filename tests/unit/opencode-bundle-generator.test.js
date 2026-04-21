import { describe, expect, it } from "vitest";

import {
  buildOpenCodeSyncBundle,
  buildOpenCodeSyncPreview,
  OPENCODE_SYNC_BUNDLE_SCHEMA_VERSION,
} from "../../src/lib/opencodeSync/generator.js";
import {
  OPENAGENT_PRESET_PLUGIN,
  OPENCODE_SYNC_PLUGIN,
  SLIM_PRESET_PLUGIN,
} from "../../src/lib/opencodeSync/presets.js";

describe("buildOpenCodeSyncBundle", () => {
  const modelCatalog = {
    "anthropic/claude-3.7-sonnet": { label: "Claude 3.7 Sonnet" },
    "openai/gpt-4.1": { label: "GPT-4.1" },
    "xai/grok-3-mini": { label: "Grok 3 Mini" },
  };

  it("includes sync and openagent preset plugins deterministically", () => {
    const result = buildOpenCodeSyncBundle({
      preferences: {
        variant: "openagent",
        customPlugins: ["zeta-plugin@latest", "alpha-plugin@latest", OPENCODE_SYNC_PLUGIN],
        excludedModels: ["xai/grok-3-mini"],
      },
      modelCatalog,
    });

    expect(result.schemaVersion).toBe(OPENCODE_SYNC_BUNDLE_SCHEMA_VERSION);
    expect(result.bundle.plugins).toEqual([
      OPENCODE_SYNC_PLUGIN,
      OPENAGENT_PRESET_PLUGIN,
      "alpha-plugin@latest",
      "zeta-plugin@latest",
    ]);
    expect(Object.keys(result.bundle.models)).toEqual([
      "anthropic/claude-3.7-sonnet",
      "openai/gpt-4.1",
    ]);
  });

  it("supports custom include mode without preset plugin injection", () => {
    const result = buildOpenCodeSyncBundle({
      preferences: {
        variant: "custom",
        customTemplate: "opinionated",
        modelSelectionMode: "include",
        includedModels: ["openai/gpt-4.1", "anthropic/claude-3.7-sonnet", "openai/gpt-4.1"],
        customPlugins: ["team-plugin@latest"],
      },
      modelCatalog,
    });

    expect(result.bundle.plugins).toEqual([
      OPENCODE_SYNC_PLUGIN,
      "team-plugin@latest",
    ]);
    expect(result.bundle.plugins).not.toContain(OPENAGENT_PRESET_PLUGIN);
    expect(result.bundle.plugins).not.toContain(SLIM_PRESET_PLUGIN);
    expect(Object.keys(result.bundle.models)).toEqual([
      "anthropic/claude-3.7-sonnet",
      "openai/gpt-4.1",
    ]);
    expect(result.bundle.advancedOverrides).toEqual({
      generation: {
        strategy: "assisted",
      },
      safety: {
        confirmations: true,
      },
      ui: {
        mode: "opinionated",
      },
    });
  });

  it("applies deterministic custom template presets to bundle output", () => {
    const minimal = buildOpenCodeSyncBundle({
      preferences: {
        variant: "custom",
        customTemplate: "minimal",
      },
      modelCatalog,
    });

    const opinionated = buildOpenCodeSyncBundle({
      preferences: {
        variant: "custom",
        customTemplate: "opinionated",
      },
      modelCatalog,
    });

    expect(minimal.bundle.advancedOverrides).toEqual({
      generation: {
        strategy: "manual",
      },
      ui: {
        mode: "minimal",
      },
    });
    expect(opinionated.bundle.advancedOverrides).toEqual({
      generation: {
        strategy: "assisted",
      },
      safety: {
        confirmations: true,
      },
      ui: {
        mode: "opinionated",
      },
    });
    expect(minimal.hash).not.toBe(opinionated.hash);
  });

  it("lets explicit custom overrides extend template preset output", () => {
    const result = buildOpenCodeSyncBundle({
      preferences: {
        variant: "custom",
        customTemplate: "minimal",
        advancedOverrides: {
          custom: {
            generation: {
              strategy: "guided",
            },
            safety: {
              confirmations: false,
            },
          },
        },
      },
      modelCatalog,
    });

    expect(result.bundle.advancedOverrides).toEqual({
      generation: {
        strategy: "guided",
      },
      safety: {
        confirmations: false,
      },
      ui: {
        mode: "minimal",
      },
    });
  });

  it("keeps revision and hash stable for same effective input", () => {
    const first = buildOpenCodeSyncPreview({
      preferences: {
        variant: "openagent",
        customPlugins: ["zeta-plugin@latest", "alpha-plugin@latest"],
        excludedModels: ["xai/grok-3-mini"],
        updatedAt: "2026-04-21T12:00:00.000Z",
      },
      modelCatalog: [
        { id: "openai/gpt-4.1", label: "GPT-4.1" },
        { id: "xai/grok-3-mini", label: "Grok 3 Mini" },
        { id: "anthropic/claude-3.7-sonnet", label: "Claude 3.7 Sonnet" },
      ],
    });

    const second = buildOpenCodeSyncPreview({
      preferences: {
        variant: "openagent",
        customPlugins: ["alpha-plugin@latest", "zeta-plugin@latest"],
        excludedModels: ["xai/grok-3-mini"],
        updatedAt: "2026-04-21T13:00:00.000Z",
      },
      modelCatalog,
    });

    expect(second.revision).toBe(first.revision);
    expect(second.hash).toBe(first.hash);
    expect(second.preview).toEqual(first.preview);
  });
});
