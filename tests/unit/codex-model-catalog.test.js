import { describe, expect, it } from "vitest";
import { buildCodexModelCatalog } from "../../src/lib/cliTools/codexModelCatalog.js";

// Minimal stand-ins for `codex debug models --bundled` entries; real ones carry
// ~80KB of instructions, which is exactly why the builder clones instead of synthesizing.
const entry = (slug, overrides = {}) => ({
  slug,
  display_name: slug.toUpperCase(),
  description: `${slug} description`,
  supported_reasoning_levels: [{ effort: "medium", description: "Balanced" }],
  support_verbosity: true,
  shell_type: "unified_exec",
  truncation_policy: { mode: "tokens", limit: 10000 },
  priority: 1,
  visibility: "list",
  supported_in_api: true,
  experimental_supported_tools: [],
  base_instructions: `instructions for ${slug}`,
  model_messages: { instructions_template: `template for ${slug}` },
  service_tiers: [{ id: "priority", name: "Fast" }],
  additional_speed_tiers: ["fast"],
  availability_nux: null,
  upgrade: null,
  context_window: 272000,
  max_context_window: 872000,
  ...overrides,
});

// Code-mode flags carried by gpt-6-astra / gpt-5.6-* in the real bundled catalog
const codeMode = {
  tool_mode: "code_mode_only",
  use_responses_lite: true,
  multi_agent_version: "v2",
};

const bundled = {
  models: [
    entry("gpt-5.6-sol", { priority: 6, ...codeMode }),
    entry("gpt-6-astra", {
      priority: 1,
      ...codeMode,
      multi_agent_reasoning_effort: "xhigh",
      experimental_supported_tools: ["send_user_message_async", "clock"],
    }),
    entry("gpt-5.6-terra", { priority: 7, ...codeMode }),
    entry("gpt-5.5", { priority: 12 }),
    entry("gpt-hidden-first", { priority: 0, visibility: "hide" }),
    entry("gpt-5.4", {
      priority: 16,
      visibility: "hide",
      upgrade: { model: "gpt-5.6-terra", migration_markdown: "retired", retirement_at: "2026-08-31T19:00:00Z" },
    }),
    entry("codex-auto-review", { priority: 43, visibility: "hide" }),
  ],
};

const listed = (catalog) => catalog.models.filter((m) => m.visibility === "list");
const bySlug = (catalog, slug) => catalog.models.find((m) => m.slug === slug);

describe("buildCodexModelCatalog", () => {
  it("clones the bundled entry matching the part after the last slash", () => {
    const catalog = buildCodexModelCatalog(bundled, ["mirbud/gpt-5.6-terra", "a/b/gpt-5.6-sol"]);
    const terra = bySlug(catalog, "mirbud/gpt-5.6-terra");
    expect(terra.base_instructions).toBe("instructions for gpt-5.6-terra");
    expect(terra.model_messages.instructions_template).toBe("template for gpt-5.6-terra");
    expect(terra.display_name).toBe("mirbud/gpt-5.6-terra");
    expect(terra.visibility).toBe("list");
    // Matched templates keep Codex's own tiers and window for that model
    expect(terra.service_tiers).toEqual([{ id: "priority", name: "Fast" }]);
    expect(terra.context_window).toBe(272000);
    expect(bySlug(catalog, "a/b/gpt-5.6-sol").base_instructions).toBe("instructions for gpt-5.6-sol");
  });

  it("falls back to bundled gpt-5.5 for unknown models", () => {
    const catalog = buildCodexModelCatalog(bundled, ["cc/claude-opus", "Opus_like"]);
    for (const slug of ["cc/claude-opus", "Opus_like"]) {
      const clone = bySlug(catalog, slug);
      expect(clone.base_instructions).toBe("instructions for gpt-5.5");
      expect(clone.service_tiers).toEqual([]);
      expect(clone.additional_speed_tiers).toEqual([]);
      expect(clone.description).toContain("gpt-5.5");
    }
  });

  it("without gpt-5.5, falls back to the lowest-priority plain listed entry", () => {
    const models = [
      ...bundled.models.filter((m) => m.slug !== "gpt-5.5"),
      entry("gpt-plain-late", { priority: 30 }),
      entry("gpt-plain-early", { priority: 20 }),
      entry("gpt-plain-hidden", { priority: 2, visibility: "hide" }),
    ];
    const clone = bySlug(buildCodexModelCatalog({ models }, ["cc/claude-opus"]), "cc/claude-opus");
    expect(clone.base_instructions).toBe("instructions for gpt-plain-early");
  });

  it("with only code-mode entries, falls back to the lowest-priority listed entry", () => {
    const models = bundled.models.filter((m) => m.slug !== "gpt-5.5");
    const clone = bySlug(buildCodexModelCatalog({ models }, ["cc/claude-opus"]), "cc/claude-opus");
    // gpt-hidden-first has priority 0 but is hidden, so astra wins
    expect(clone.base_instructions).toBe("instructions for gpt-6-astra");
  });

  it("neutralizes code-mode flags for non-Codex providers and combos", () => {
    const models = buildCodexModelCatalog({ models: bundled.models.filter((m) => m.slug !== "gpt-5.5") }, [
      "kr/gpt-5.6-terra",
      "mirbud/gpt-6-astra",
      "Opus_like",
      "cc/claude-opus",
    ]);
    for (const slug of ["kr/gpt-5.6-terra", "mirbud/gpt-6-astra", "Opus_like", "cc/claude-opus"]) {
      expect(bySlug(models, slug)).toMatchObject({
        tool_mode: null,
        use_responses_lite: false,
        multi_agent_version: null,
        multi_agent_reasoning_effort: null,
        experimental_supported_tools: [],
      });
    }
    // Instructions still come from the matched template
    expect(bySlug(models, "kr/gpt-5.6-terra").base_instructions).toBe("instructions for gpt-5.6-terra");
  });

  it("keeps Codex values for Codex-provider entries matched to a bundled slug", () => {
    const catalog = buildCodexModelCatalog(bundled, ["cx/gpt-6-astra", "codex/gpt-5.6-terra"]);
    expect(bySlug(catalog, "cx/gpt-6-astra")).toMatchObject({
      ...codeMode,
      multi_agent_reasoning_effort: "xhigh",
      experimental_supported_tools: ["send_user_message_async", "clock"],
    });
    expect(bySlug(catalog, "codex/gpt-5.6-terra")).toMatchObject(codeMode);
    // Hidden bundled originals are never neutralized
    expect(bySlug(catalog, "gpt-5.6-sol")).toMatchObject(codeMode);
  });

  it("uses the 9Router context length only for default-template clones", () => {
    const catalog = buildCodexModelCatalog(bundled, [
      { id: "cc/claude-opus", context_length: 200000 },
      { id: "cx/gpt-5.6-terra", context_length: 128000 },
      { id: "kr/unknown" },
    ]);
    expect(bySlug(catalog, "cc/claude-opus")).toMatchObject({ context_window: 200000, max_context_window: 200000 });
    expect(bySlug(catalog, "cx/gpt-5.6-terra")).toMatchObject({ context_window: 272000, max_context_window: 872000 });
    expect(bySlug(catalog, "kr/unknown")).toMatchObject({ context_window: 272000, max_context_window: 872000 });
  });

  it("clears inherited upgrade prompts on 9Router entries only", () => {
    const catalog = buildCodexModelCatalog(bundled, ["mirbud/gpt-5.4"]);
    const clone = bySlug(catalog, "mirbud/gpt-5.4");
    expect(clone.base_instructions).toBe("instructions for gpt-5.4");
    expect(clone.upgrade).toBeNull();
    expect(clone.availability_nux).toBeNull();
    expect(bySlug(catalog, "gpt-5.4").upgrade).toMatchObject({ model: "gpt-5.6-terra" });
  });

  it("keeps every bundled entry but hides it from the picker", () => {
    const catalog = buildCodexModelCatalog(bundled, ["cx/gpt-5.6-terra"]);
    expect(listed(catalog).map((m) => m.slug)).toEqual(["cx/gpt-5.6-terra"]);
    for (const original of bundled.models) {
      const kept = bySlug(catalog, original.slug);
      expect(kept.visibility).toBe("hide");
      expect(kept.base_instructions).toBe(original.base_instructions);
    }
    // Input catalog is not mutated
    expect(bundled.models.find((m) => m.slug === "gpt-6-astra").visibility).toBe("list");
  });

  it("lets a 9Router id win over a bundled slug without duplicating it", () => {
    const catalog = buildCodexModelCatalog(bundled, ["gpt-5.6-terra", "gpt-5.6-terra"]);
    const matches = catalog.models.filter((m) => m.slug === "gpt-5.6-terra");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ visibility: "list", priority: 1, display_name: "gpt-5.6-terra" });
    const slugs = catalog.models.map((m) => m.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("orders 9Router entries by input order ahead of hidden bundled entries", () => {
    const ids = ["Opus_like", "cx/gpt-5.6-terra", "cc/claude-opus"];
    const catalog = buildCodexModelCatalog(bundled, ids);
    expect(listed(catalog).map((m) => [m.slug, m.priority])).toEqual([
      ["Opus_like", 1],
      ["cx/gpt-5.6-terra", 2],
      ["cc/claude-opus", 3],
    ]);
    const hiddenPriorities = catalog.models.filter((m) => m.visibility === "hide").map((m) => m.priority);
    expect(Math.min(...hiddenPriorities)).toBeGreaterThan(ids.length);
  });

  it("preserves the fields Codex requires to parse an entry", () => {
    const required = [
      "slug", "display_name", "supported_reasoning_levels", "support_verbosity", "shell_type",
      "truncation_policy", "priority", "visibility", "supported_in_api", "experimental_supported_tools",
    ];
    const catalog = buildCodexModelCatalog(bundled, ["cx/gpt-5.6-terra", "cc/claude-opus"]);
    for (const model of catalog.models) {
      for (const key of required) expect(model).toHaveProperty(key);
      expect(model.base_instructions || model.model_messages?.instructions_template).toBeTruthy();
    }
  });

  it("returns an empty catalog when there is nothing to clone from", () => {
    expect(buildCodexModelCatalog({ models: [] }, ["cx/gpt-5.6-terra"])).toEqual({ models: [] });
    expect(buildCodexModelCatalog(null, ["cx/gpt-5.6-terra"])).toEqual({ models: [] });
    expect(listed(buildCodexModelCatalog(bundled, [" ", null, 42]))).toEqual([]);
  });
});
