/**
 * Tests for the OpenCode model config converter.
 *
 * Bead: 9r-ocmr.e1.02
 * PRD:  REQ-001, REQ-002, REQ-004, VAL-001, VAL-002, VAL-004
 */

import { describe, it, expect } from "vitest";
import { buildOpenCodeModelConfig, buildOpenCodeReasoningVariants, mergeOpenCodeModelConfig } from "@/app/api/cli-tools/opencode-settings/converter.js";

describe("buildOpenCodeModelConfig (9r-ocmr.e1.02)", () => {
  // ── Known reasoning + vision model ──────────────────────────────

  it("returns correct limits and flags for claude-opus-4.6", async () => {
    const config = await buildOpenCodeModelConfig(null, "claude-opus-4.6");

    expect(config.name).toBe("claude-opus-4.6");
    expect(config.limit.context).toBeGreaterThan(0);
    expect(config.limit.input).toBeGreaterThan(0);
    expect(config.limit.output).toBeGreaterThan(0);
    // Claude opus 4.6 pattern: contextWindow 1_000_000, maxOutput 128_000
    expect(config.limit.context).toBe(1_000_000);
    expect(config.limit.output).toBe(128_000);
    // Reasoning + vision + tools
    expect(config.reasoning).toBe(true);
    expect(config.tool_call).toBe(true);
    expect(config.attachment).toBe(true);
    // Vision → image in input
    expect(config.modalities.input).toContain("image");
    expect(config.modalities.output).toContain("text");
  });

  // ── Unknown model falls back safely (REQ-002 / VAL-002) ────────

  it("falls back to defaults for unknown model without crashing", async () => {
    const config = await buildOpenCodeModelConfig(null, "unknown-model-xyz");

    expect(config.name).toBe("unknown-model-xyz");
    // Default contextWindow: 200_000, maxOutput: 64_000
    expect(config.limit.context).toBe(200_000);
    expect(config.limit.input).toBe(200_000);
    expect(config.limit.output).toBe(64_000);
    // Defaults: reasoning false, tools true
    expect(config.reasoning).toBe(false);
    expect(config.tool_call).toBe(true);
    expect(config.attachment).toBe(false);
    // Only text modalities
    expect(config.modalities.input).toEqual(["text"]);
    expect(config.modalities.output).toEqual(["text"]);
  });

  // ── Non-reasoning model with smaller context (gpt-3.5) ─────────

  it("returns reasoning:false and smaller limits for gpt-3.5-turbo", async () => {
    const config = await buildOpenCodeModelConfig(null, "gpt-3.5-turbo");

    expect(config.reasoning).toBe(false);
    expect(config.limit.context).toBe(16_385);
    expect(config.limit.output).toBe(4_096);
  });

  // ── Image output model with tools disabled (gpt-image-1) ───────

  it("maps imageOutput and tools:false for gpt-image-1", async () => {
    const config = await buildOpenCodeModelConfig(null, "gpt-image-1");

    expect(config.modalities.output).toContain("image");
    expect(config.tool_call).toBe(false);
    // No vision/pdf/audio/video → no attachment
    expect(config.attachment).toBe(false);
  });

  // ── Vendor prefix stripping (anthropic/claude-opus-4.6) ────────

  it("strips vendor prefix when resolving capabilities", async () => {
    const config = await buildOpenCodeModelConfig(null, "anthropic/claude-opus-4.6");

    expect(config.name).toBe("anthropic/claude-opus-4.6");
    expect(config.limit.context).toBe(1_000_000);
    expect(config.reasoning).toBe(true);
  });

  // ── No credentials or unsafe options (security) ────────────────

  it("does not include credentials, headers, or arbitrary options", async () => {
    const config = await buildOpenCodeModelConfig(null, "claude-opus-4.6");

    const keys = Object.keys(config).sort();
    expect(keys).toEqual(
      ["attachment", "limit", "modalities", "name", "reasoning", "tool_call", "variants"],
    );
    // No apiKey, headers, options, baseURL, or other provider fields
    expect(config).not.toHaveProperty("apiKey");
    expect(config).not.toHaveProperty("headers");
    expect(config).not.toHaveProperty("options");
    expect(config).not.toHaveProperty("baseURL");
  });
});

describe("buildOpenCodeReasoningVariants (9r-ocmr.e1.04)", () => {
  it("returns variants with reasoningEffort for reasoning-capable models", () => {
    const caps = { reasoning: true };
    const variants = buildOpenCodeReasoningVariants(caps);

    expect(variants).toBeDefined();
    expect(Object.keys(variants).sort()).toEqual(["high", "low", "max", "medium"]);
    expect(variants.low).toEqual({ reasoningEffort: "low" });
    expect(variants.medium).toEqual({ reasoningEffort: "medium" });
    expect(variants.high).toEqual({ reasoningEffort: "high" });
    expect(variants.max).toEqual({ reasoningEffort: "max" });
  });

  it("returns undefined for non-reasoning models", () => {
    const caps = { reasoning: false };
    expect(buildOpenCodeReasoningVariants(caps)).toBeUndefined();
  });

  it("does not globally force high/max in any variant", async () => {
    const config = await buildOpenCodeModelConfig(null, "claude-opus-4.6");
    expect(config.variants).toBeDefined();
    // Each variant has exactly one key: reasoningEffort
    for (const [level, variant] of Object.entries(config.variants)) {
      expect(Object.keys(variant)).toEqual(["reasoningEffort"]);
      expect(variant.reasoningEffort).toBe(level);
    }
  });

  it("non-reasoning model has no variants key", async () => {
    const config = await buildOpenCodeModelConfig(null, "gpt-3.5-turbo");
    expect(config).not.toHaveProperty("variants");
  });

  it("reasoning flag is present in setup output for reasoning model", async () => {
    const config = await buildOpenCodeModelConfig(null, "claude-opus-4.6");
    expect(config.reasoning).toBe(true);
  });
});

describe("mergeOpenCodeModelConfig (9r-ocmr.e1.03)", () => {
  const generated = {
    name: "claude-opus-4.6",
    modalities: { input: ["text", "image"], output: ["text"] },
    reasoning: true,
    tool_call: true,
    attachment: true,
    limit: { context: 1_000_000, input: 1_000_000, output: 128_000 },
  };

  it("returns generated config when no existing entry", () => {
    const result = mergeOpenCodeModelConfig(generated);
    expect(result.name).toBe(generated.name);
    expect(result.modalities).toEqual(generated.modalities);
    expect(result.reasoning).toBe(generated.reasoning);
    expect(result.tool_call).toBe(generated.tool_call);
    expect(result.attachment).toBe(generated.attachment);
    expect(result.limit).toEqual(generated.limit);
    // Merge always materializes options/headers/variants (harmless empty objects)
    expect(result.options).toEqual({});
    expect(result.headers).toEqual({});
    expect(result.variants).toEqual({});
  });

  it("existing limit overrides generated limit fields", () => {
    const existing = { limit: { context: 500_000 } };
    const result = mergeOpenCodeModelConfig(generated, existing);
    expect(result.limit).toEqual({ context: 500_000, input: 1_000_000, output: 128_000 });
  });

  it("existing options/headers/variants are preserved and merged", () => {
    const existing = {
      options: { temperature: 0.5 },
      headers: { "X-Custom": "value" },
      variants: { low: { reasoningEffort: "low" } },
    };
    const result = mergeOpenCodeModelConfig(generated, existing);
    expect(result.options).toEqual({ temperature: 0.5 });
    expect(result.headers).toEqual({ "X-Custom": "value" });
    expect(result.variants).toEqual({ low: { reasoningEffort: "low" } });
  });

  it("existing modalities win over generated", () => {
    const existing = { modalities: { input: ["text"], output: ["text"] } };
    const result = mergeOpenCodeModelConfig(generated, existing);
    expect(result.modalities).toEqual({ input: ["text"], output: ["text"] });
  });

  it("unknown custom top-level fields survive merge", () => {
    const existing = { customField: "should-survive", anotherKey: 42 };
    const result = mergeOpenCodeModelConfig(generated, existing);
    expect(result.customField).toBe("should-survive");
    expect(result.anotherKey).toBe(42);
  });

  it("generated flags fill blanks when absent from existing", () => {
    const existing = { limit: { context: 500_000 } };
    const result = mergeOpenCodeModelConfig(generated, existing);
    expect(result.reasoning).toBe(true);
    expect(result.tool_call).toBe(true);
    expect(result.attachment).toBe(true);
  });

  it("idempotent: merging same config twice produces same result", () => {
    const existing = {
      limit: { context: 500_000 },
      options: { temperature: 0.5 },
      customField: "keep",
    };
    const first = mergeOpenCodeModelConfig(generated, existing);
    const second = mergeOpenCodeModelConfig(first, existing);
    expect(second).toEqual(first);
  });
});
