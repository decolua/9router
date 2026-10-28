import { describe, expect, it } from "vitest";

import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking, stripThinkingSuffix } from "../../open-sse/translator/concerns/thinkingUnified.js";

describe("Gemini 4 Argon capabilities", () => {
  it.each(["gemini", "vertex", "antigravity"])("declares level-based always-on reasoning on %s", (provider) => {
    const model = provider === "antigravity" ? "gemini-4-argon-high" : "gemini-4-argon";
    const caps = getCapabilitiesForModel(provider, model);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("gemini-level");
    expect(caps.thinkingCanDisable).toBe(false);
    expect(caps.contextWindow).toBe(1048576);
    expect(caps.maxOutput).toBe(65536);
    expect(getThinkingLevels(provider, model)).toEqual(["low", "medium", "high"]);
  });
});

describe("Gemini 4 Argon thinking clamp", () => {
  // Argon rejects thinkingLevel "minimal" (and thinkingBudget) with HTTP 400 —
  // every path that would emit "minimal" must clamp to the lowest supported level.
  it("clamps an explicit reasoning_effort none to low", () => {
    const body = { reasoning_effort: "none" };
    applyThinking("gemini", "gemini-4-argon", body, "vertex");
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low", includeThoughts: true });
  });

  it("clamps a small thinking budget (minimal after conversion) to low", () => {
    const body = { thinking: { type: "enabled", budget_tokens: 512 } };
    applyThinking("gemini", "gemini-4-argon", body, "vertex");
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low", includeThoughts: true });
  });

  it("passes supported levels through untouched", () => {
    const body = { reasoning_effort: "high" };
    applyThinking("gemini", "gemini-4-argon", body, "vertex");
    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe("high");
  });

  it("keeps minimal for Gemini 3 models (regression guard)", () => {
    const body = { reasoning_effort: "none" };
    applyThinking("gemini", "gemini-3.8-flash", body, "gemini");
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "minimal", includeThoughts: false });
  });
});

describe("Gemini 4 Argon Antigravity tier", () => {
  it.each([
    ["gemini-4-argon-high", "high"],
    ["gemini-4-argon-medium", "medium"],
    ["gemini-4-argon-low", "low"],
  ])("maps %s to the wire model with a %s thinking level", (modelId, expectedLevel) => {
    const upstreamModel = getModelUpstreamId("ag", modelId);
    expect(upstreamModel).toBe(`${modelId}(${expectedLevel})`);

    const body = {
      model: stripThinkingSuffix(upstreamModel),
      request: {
        contents: [{ role: "user", parts: [{ text: "hello" }] }],
        generationConfig: {},
      },
    };

    applyThinking("antigravity", upstreamModel, body, "antigravity");
    const finalBody = new AntigravityExecutor().transformRequest(
      modelId,
      body,
      true,
      { projectId: "project", connectionId: "connection" }
    );

    expect(finalBody.model).toBe(modelId);
    expect(finalBody.request.generationConfig.thinkingConfig).toEqual({ thinkingLevel: expectedLevel, includeThoughts: true });
  });

  it.each([
    ["high effort", { reasoning_effort: "high" }, "gemini-4-argon-high(high)"],
    ["low effort", { reasoning_effort: "low" }, "gemini-4-argon-low(low)"],
    ["medium effort", { reasoning_effort: "medium" }, "gemini-4-argon-medium(medium)"],
    ["default medium when omitted", {}, "gemini-4-argon-medium(medium)"],
    ["high via budget tokens", { thinking: { budget_tokens: 24576 } }, "gemini-4-argon-high(high)"],
    ["low via budget tokens", { thinking: { budget_tokens: 2048 } }, "gemini-4-argon-low(low)"],
    ["medium via budget tokens", { thinking: { budget_tokens: 8192 } }, "gemini-4-argon-medium(medium)"],
    ["output_config effort", { output_config: { effort: "low" } }, "gemini-4-argon-low(low)"],
  ])("resolves unadorned gemini-4-argon to %s based on client request", (_, body, expectedUpstream) => {
    const upstreamModel = getModelUpstreamId("ag", "gemini-4-argon", body);
    expect(upstreamModel).toBe(expectedUpstream);
  });
});
