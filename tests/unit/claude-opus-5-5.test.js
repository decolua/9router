import { describe, expect, it } from "vitest";

import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import "../translator/registerAll.js";

// Opus 5.5: $4 / $20 per 1M, cache read $0.20, 5m cache write $5.
// Thinking is always on and forced tool_choice (any/tool) returns 400.
const OPUS_55_IDS = ["claude-opus-5-5", "claude-opus-5-5-high", "claude-opus-5-5-medium", "claude-opus-5-5-low"];

describe("Claude Opus 5.5", () => {
  it("is listed for the claude provider", () => {
    expect(getModelsByProviderId("claude").some((model) => model.id === "claude-opus-5-5")).toBe(true);
  });

  it.each(OPUS_55_IDS)("%s resolves to always-on adaptive thinking without forced tools", (model) => {
    expect(getCapabilitiesForModel("claude", model)).toMatchObject({
      reasoning: true,
      thinkingFormat: "claude-adaptive",
      thinkingCanDisable: false,
      forcedToolChoice: false,
      contextWindow: 1000000,
      maxOutput: 128000,
    });
  });

  it("does not advertise the none thinking level", () => {
    expect(getThinkingLevels("claude", "claude-opus-5-5")).not.toContain("none");
  });

  it.each(OPUS_55_IDS)("prices %s at Opus 5.5 rates", (model) => {
    expect(getPricingForModel("claude", model)).toEqual({ input: 4, output: 20, cached: 0.2, reasoning: 20, cache_creation: 5 });
  });
});

describe("Claude Opus 5.5 request shape", () => {
  const prepare = (body) => prepareClaudeRequest({ max_tokens: 1024, messages: [{ role: "user", content: "hi" }], ...body }, "claude");
  const think = (body) => applyThinking("claude", "claude-opus-5-5", body, "claude");

  it("clamps thinking off to low effort and never sends a thinking switch", () => {
    const body = think({ reasoning_effort: "none" });
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toEqual({ effort: "low" });
  });

  it("maps auto effort to high without a thinking switch", () => {
    const body = think({ thinking: { type: "adaptive" } });
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toEqual({ effort: "high" });
  });

  it("maps forced tool_choice to auto", () => {
    expect(prepare({ model: "claude-opus-5-5", tool_choice: { type: "any" } }).tool_choice).toEqual({ type: "auto" });
    expect(prepare({ model: "claude-opus-5-5", tool_choice: { type: "tool", name: "run", disable_parallel_tool_use: true } }).tool_choice)
      .toEqual({ type: "auto", disable_parallel_tool_use: true });
  });

  it("leaves Opus 5 forced tool_choice untouched", () => {
    expect(prepare({ model: "claude-opus-5", tool_choice: { type: "any" } }).tool_choice).toEqual({ type: "any" });
  });

  it("covers the OpenAI-client path end to end", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-opus-5-5", {
      model: "claude-opus-5-5", reasoning_effort: "none", tool_choice: "required",
      tools: [{ type: "function", function: { name: "run", parameters: { type: "object", properties: {} } } }],
      messages: [{ role: "user", content: "hi" }],
    }, true, null, "claude");
    expect(out.thinking?.type).not.toBe("disabled");
    expect(out.output_config).toEqual({ effort: "low" });
    expect(out.tool_choice.type).toBe("auto");
  });
});
