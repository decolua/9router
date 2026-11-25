import { describe, it, expect } from "vitest";
import { applyModelEffort, modelEffortFor } from "../../open-sse/services/modelEffort.js";

/**
 * The provider-level "Thinking" setting is one value for every model of a
 * provider, and only fills in an effort the client did not send. Models of one
 * provider want different efforts (a small model low, a big one high), and an
 * agent client always sends an effort of its own — so a per-model setting is
 * kept next to it, and is the operator's explicit choice for that model: it is
 * applied over the client's.
 */

const CONFIG = { mode: "auto", models: { "gpt-6-luna": "low", "gpt-6-astra": "high" } };

describe("modelEffortFor", () => {
  it("reads the level set for this model", () => {
    expect(modelEffortFor("codex", "gpt-6-luna", CONFIG)).toBe("low");
    expect(modelEffortFor("codex", "gpt-6-astra", CONFIG)).toBe("high");
  });

  it("is nothing for a model with no setting, or none at all", () => {
    expect(modelEffortFor("codex", "gpt-6-sol", CONFIG)).toBeNull();
    expect(modelEffortFor("codex", "gpt-6-luna", null)).toBeNull();
    expect(modelEffortFor("codex", "gpt-6-luna", { mode: "high" })).toBeNull();
  });

  it("ignores a level the model does not take, so a stale setting cannot break requests", () => {
    expect(modelEffortFor("codex", "gpt-6-luna", { models: { "gpt-6-luna": "bogus" } })).toBeNull();
    // A model that cannot reason has no effort to set.
    expect(modelEffortFor("openai", "gpt-4o-mini", { models: { "gpt-4o-mini": "high" } })).toBeNull();
  });

  it("treats auto and empty as no setting", () => {
    expect(modelEffortFor("codex", "gpt-6-luna", { models: { "gpt-6-luna": "auto" } })).toBeNull();
    expect(modelEffortFor("codex", "gpt-6-luna", { models: { "gpt-6-luna": "" } })).toBeNull();
  });
});

describe("applyModelEffort", () => {
  it("sets reasoning_effort when the client sent none", () => {
    const body = { model: "gpt-6-luna", messages: [] };
    expect(applyModelEffort(body, "codex", "gpt-6-luna", CONFIG).reasoning_effort).toBe("low");
  });

  it("wins over the effort the client sent", () => {
    const out = applyModelEffort({ reasoning_effort: "high" }, "codex", "gpt-6-luna", CONFIG);
    expect(out.reasoning_effort).toBe("low");
  });

  it("wins over a reasoning object, keeping the rest of it", () => {
    const out = applyModelEffort({ reasoning: { effort: "high", summary: "detailed" } }, "codex", "gpt-6-luna", CONFIG);
    expect(out.reasoning).toEqual({ effort: "low", summary: "detailed" });
    expect(out.reasoning_effort).toBe("low");
  });

  it("writes a Claude-format body's effort where Claude reads it, not as reasoning_effort", () => {
    // reasoning_effort is not a Messages API field, and thinkingUnified reads
    // output_config.effort before it, so a Claude client would keep its own.
    const out = applyModelEffort({ output_config: { effort: "high", format: "x" } }, "codex", "gpt-6-luna", CONFIG, "claude");
    expect(out.output_config).toEqual({ effort: "low", format: "x" });
    expect(out.reasoning_effort).toBeUndefined();
    const bare = applyModelEffort({ messages: [] }, "codex", "gpt-6-luna", CONFIG, "claude");
    expect(bare.output_config).toEqual({ effort: "low" });
    expect(bare.reasoning_effort).toBeUndefined();
  });

  it("does not guess at a Gemini-format body", () => {
    const body = { contents: [] };
    expect(applyModelEffort(body, "codex", "gpt-6-luna", CONFIG, "gemini")).toBe(body);
    expect(applyModelEffort(body, "codex", "gpt-6-luna", CONFIG, "gemini-cli")).toBe(body);
  });

  it("leaves the body alone when the model has no setting", () => {
    const body = { reasoning_effort: "medium" };
    expect(applyModelEffort(body, "codex", "gpt-6-sol", CONFIG)).toBe(body);
  });

  it("does not mutate the body it was given", () => {
    const body = { reasoning_effort: "high", reasoning: { effort: "high" } };
    const copy = JSON.parse(JSON.stringify(body));
    applyModelEffort(body, "codex", "gpt-6-luna", CONFIG);
    expect(body).toEqual(copy);
  });
});
