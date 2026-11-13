import { describe, expect, it, vi } from "vitest";

import { getModelsByProviderId, getModelUpstreamId, isValidModel } from "../../open-sse/config/providerModels.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { translateRequest, translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { applyThinking, captureThinking, shouldSuppressHydrogenThoughts, stripThinkingSuffix, withProviderThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";

const model = "gemini-4-hydrogen";
const levels = ["low", "medium", "high", "xhigh"];

function antigravityRequest(modelId) {
  const upstreamId = getModelUpstreamId("ag", modelId);
  const body = {
    model: stripThinkingSuffix(upstreamId),
    request: { contents: [{ role: "user", parts: [{ text: "hello" }] }], generationConfig: {} },
  };
  applyThinking("antigravity", upstreamId, body, "antigravity");
  return new AntigravityExecutor().transformRequest(modelId, body, true, {
    projectId: "project",
    connectionId: "connection",
  });
}

describe("Gemini 4 Hydrogen catalog", () => {
  it("exposes the Gemini API ID and the Antigravity effort variants", () => {
    expect(isValidModel("gemini", model)).toBe(true);
    expect(getModelsByProviderId("antigravity").filter((entry) => entry.id.startsWith(model)).map((entry) => entry.id))
      .toEqual([...levels.map((level) => `${model}-${level}`), model]);
  });

  it.each(["gemini", "antigravity"])("advertises all four thinking levels on the %s alias", (provider) => {
    const id = model;
    expect(getThinkingLevels(provider, id)).toEqual(levels);
    expect(getCapabilitiesForModel(provider, id)).toMatchObject({
      reasoning: true,
      thinkingFormat: "gemini-level",
      thinkingCanDisable: false,
      contextWindow: 1048576,
      maxOutput: 65536,
    });
  });

  it("uses Hydrogen pricing instead of the generic Gemini 4 estimate", () => {
    expect(getPricingForModel("gemini", model)).toMatchObject({ input: 1.5, output: 7.5, cached: 0.075 });
    expect(getPricingForModel("antigravity", `${model}-xhigh`)).toMatchObject({ input: 1.5, output: 7.5 });
  });
});

describe("Gemini 4 Hydrogen thinking", () => {
  it.each(levels)("preserves %s on the Gemini API wire", (level) => {
    const body = { reasoning_effort: level };
    applyThinking("gemini", model, body, "gemini");
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: level, includeThoughts: true });
  });

  it("clamps disabled thinking to low and suppresses thought summaries", () => {
    const body = { reasoning_effort: "none" };
    applyThinking("gemini", model, body, "gemini");
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low", includeThoughts: false });
  });

  it.each(levels)("routes the Antigravity %s variant without changing its model ID", (level) => {
    const id = `${model}-${level}`;
    expect(getModelUpstreamId("ag", id)).toBe(`${id}(${level})`);
    const request = antigravityRequest(id);
    expect(request.model).toBe(id);
    expect(request.request.generationConfig.thinkingConfig).toEqual({ thinkingLevel: level, includeThoughts: true });
  });

  it("defaults the Antigravity alias to high", () => {
    expect(getModelUpstreamId("ag", model)).toBe(`${model}-high(high)`);
    const request = antigravityRequest(model);
    expect(request.model).toBe(`${model}-high`);
    expect(request.request.generationConfig.thinkingConfig.thinkingLevel).toBe("high");
  });

  it("keeps an explicit xhigh suffix when selecting the Antigravity alias", () => {
    expect(getModelUpstreamId("ag", `${model}(xhigh)`)).toBe(`${model}-xhigh(xhigh)`);
    expect(getModelUpstreamId("ag", model, { reasoning_effort: "xhigh" })).toBe(`${model}-xhigh(xhigh)`);
  });

  it("honors native Gemini thinkingConfig when selecting an Antigravity tier", () => {
    expect(getModelUpstreamId("ag", model, {
      generationConfig: { thinkingConfig: { thinkingLevel: "xhigh" } },
    })).toBe(`${model}-xhigh(xhigh)`);
  });

  it("honors a top-level native Gemini thinkingConfig", () => {
    expect(getModelUpstreamId("ag", model, {
      thinkingConfig: { thinkingLevel: "xhigh" },
    })).toBe(`${model}-xhigh(xhigh)`);
    expect(getModelUpstreamId("ag", model, {
      thinkingConfig: { thinkingBudget: 0 },
    })).toBe(`${model}-low(none)`);
  });

  it("applies the configured provider tier before resolving the upstream model", () => {
    const body = { model: `ag/${model}` };
    expect(getModelUpstreamId("ag", model, withProviderThinking(body, { mode: "xhigh" })))
      .toBe(`${model}-xhigh(xhigh)`);
    expect(body).toEqual({ model: `ag/${model}` });
    expect(withProviderThinking({ ...body, reasoning_effort: "low" }, { mode: "xhigh" }).reasoning_effort)
      .toBe("low");
  });

  it("does not override native client thinking with a provider default", () => {
    const nativeBody = { generationConfig: { thinkingConfig: { thinkingLevel: "xhigh" } } };
    expect(withProviderThinking(nativeBody, { mode: "medium" })).toBe(nativeBody);
    expect(getModelUpstreamId("ag", model, withProviderThinking(nativeBody, { mode: "medium" })))
      .toBe(`${model}-xhigh(xhigh)`);
    const claudeBody = { output_config: { effort: "low" } };
    expect(withProviderThinking(claudeBody, { mode: "medium" })).toBe(claudeBody);
  });

  it("clamps an off request to low without returning thought summaries", () => {
    const original = { model: `ag/${model}` };
    const body = withProviderThinking(original, { mode: "off" });
    const upstream = getModelUpstreamId("ag", model, body);
    expect(upstream).toBe(`${model}-low(none)`);
    const translated = { request: { generationConfig: {} } };
    applyThinking("antigravity", upstream, translated, "antigravity");
    expect(translated.request.generationConfig.thinkingConfig)
      .toEqual({ thinkingLevel: "low", includeThoughts: false });
    expect(original).toEqual({ model: `ag/${model}` });
  });

  it.each(levels)("advertises only %s on the explicit Antigravity tier", (level) => {
    expect(getThinkingLevels("antigravity", `${model}-${level}`)).toEqual([level]);
  });

  it("preserves an explicit native opt-out of thought summaries across translation", () => {
    const input = { generationConfig: { thinkingConfig: { thinkingLevel: "xhigh", includeThoughts: false } } };
    const translated = { request: { generationConfig: {} } };
    applyThinking("antigravity", `${model}-xhigh(xhigh)`, translated, "antigravity", captureThinking(input));
    expect(translated.request.generationConfig.thinkingConfig)
      .toEqual({ thinkingLevel: "xhigh", includeThoughts: false });
  });

  it("keeps a suppress-only native opt-out through the Gemini-to-Antigravity bridge", () => {
    const input = {
      model,
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      generationConfig: { thinkingConfig: { includeThoughts: false } },
    };
    const wire = translateRequest(FORMATS.GEMINI, FORMATS.ANTIGRAVITY,
      getModelUpstreamId("ag", model, input), input, true, {}, "antigravity");
    expect(wire.request.generationConfig.thinkingConfig)
      .toEqual({ thinkingLevel: "high", includeThoughts: false });
  });

  it("keeps an opt-out in generationConfig when the level is top-level", () => {
    const input = {
      model,
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      thinkingConfig: { thinkingLevel: "high" },
      generationConfig: { thinkingConfig: { includeThoughts: false } },
    };
    const wire = translateRequest(FORMATS.GEMINI, FORMATS.ANTIGRAVITY,
      getModelUpstreamId("ag", model, input), input, true, {}, "antigravity");
    expect(wire.request.generationConfig.thinkingConfig)
      .toEqual({ thinkingLevel: "high", includeThoughts: false });
  });

  it.each([
    ["top-level", { thinkingConfig: { includeThoughts: false }, generationConfig: { thinkingConfig: { thinkingLevel: "xhigh" } } }],
    ["generationConfig", { generationConfig: { thinkingConfig: { includeThoughts: false } }, request: { generationConfig: { thinkingConfig: { thinkingLevel: "xhigh" } } } }],
  ])("keeps a mixed-location native xhigh request above a medium provider default (%s opt-out)", (_case, configs) => {
    const input = {
      model,
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      ...configs,
    };
    const effective = withProviderThinking(input, { mode: "medium" });
    expect(effective).toBe(input);
    const upstream = getModelUpstreamId("ag", model, effective);
    expect(upstream).toBe(`${model}-xhigh(xhigh)`);
    const wire = translateRequest(FORMATS.GEMINI, FORMATS.ANTIGRAVITY, upstream,
      effective, true, {}, "antigravity");
    expect(wire.request.generationConfig.thinkingConfig)
      .toEqual({ thinkingLevel: "xhigh", includeThoughts: false });
  });

  it.each([FORMATS.OPENAI, FORMATS.ANTIGRAVITY])("does not return an ignored upstream thought summary to %s clients", (clientFormat) => {
    const response = {
      response: { candidates: [{ content: { role: "model", parts: [
        { thought: true, text: "private upstream thought", thoughtSignature: "tool-signature" },
        { text: "public answer" },
      ] }, finishReason: "STOP" }] },
    };
    const state = { ...initState(clientFormat), model, suppressThoughtSummaries: true };
    const chunks = translateResponse(FORMATS.ANTIGRAVITY, clientFormat, response, state);
    const output = JSON.stringify(chunks);
    expect(output).not.toContain("private upstream thought");
    expect(output).toContain("public answer");
  });

  it("enforces the wire opt-out only for Antigravity Hydrogen requests", () => {
    const wire = { request: { generationConfig: { thinkingConfig: { includeThoughts: false } } } };
    expect(shouldSuppressHydrogenThoughts("antigravity", model, wire)).toBe(true);
    expect(shouldSuppressHydrogenThoughts("antigravity", "gemini-4-argon", wire)).toBe(false);
    expect(shouldSuppressHydrogenThoughts("gemini", model, wire)).toBe(false);
    expect(shouldSuppressHydrogenThoughts("antigravity", model, { request: {} })).toBe(false);
  });

  it("filters ignored upstream thought text in the SSE output and avoids recording raw chunks", async () => {
    const logger = { appendProviderChunk: vi.fn(), appendConvertedChunk: vi.fn() };
    const wire = { request: { generationConfig: { thinkingConfig: { includeThoughts: false } } } };
    const response = { response: { candidates: [{ content: { parts: [
      { thought: true, text: "private upstream thought" }, { text: "public answer" },
    ] }, finishReason: "STOP" }] } };
    const input = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(response)}\n\ndata: [DONE]\n\n`));
      controller.close();
    } });
    const stream = createSSETransformStreamWithLogger(FORMATS.ANTIGRAVITY, FORMATS.OPENAI,
      "antigravity", logger, null, model, null, null, null, null, null, null,
      shouldSuppressHydrogenThoughts("antigravity", model, wire));
    const output = await new Response(input.pipeThrough(stream)).text();
    expect(output).not.toContain("private upstream thought");
    expect(output).toContain("public answer");
    expect(logger.appendProviderChunk).not.toHaveBeenCalled();
  });

  it.each([FORMATS.OPENAI, FORMATS.ANTIGRAVITY])("keeps %s multi-chunk thought summaries private when upstream changes modelVersion", async (clientFormat) => {
    const onComplete = vi.fn();
    const logger = { appendProviderChunk: vi.fn(), appendConvertedChunk: vi.fn() };
    const chunks = [
      { response: { modelVersion: "upstream-other-model", candidates: [{ content: { parts: [{ text: "start" }] } }] } },
      { candidates: [{ content: { parts: [
        { thought: true, text: "private later thought" }, { text: "final answer" },
      ] }, finishReason: "STOP" }] },
    ];
    const input = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n"));
      controller.close();
    } });
    const stream = createSSETransformStreamWithLogger(FORMATS.ANTIGRAVITY, clientFormat,
      "antigravity", logger, null, model, null, null, onComplete, null, null, null, true);
    const output = await new Response(input.pipeThrough(stream)).text();
    expect(output).not.toContain("private later thought");
    expect(output).toContain("final answer");
    expect(onComplete).toHaveBeenCalled();
    expect(JSON.stringify(onComplete.mock.calls)).not.toContain("private later thought");
    expect(logger.appendProviderChunk).not.toHaveBeenCalled();
  });

  it("filters ignored upstream thought text before non-stream response logging and delivery", async () => {
    const reqLogger = { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() };
    const response = { candidates: [{ content: { role: "model", parts: [
      { thought: true, text: "private upstream thought" }, { text: "public answer" },
    ] }, finishReason: "STOP" }] };
    const result = await handleNonStreamingResponse({
      providerResponse: new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } }),
      provider: "antigravity", model, sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.ANTIGRAVITY,
      body: { messages: [] }, stream: false, translatedBody: {}, finalBody: null,
      suppressThoughtSummaries: true, requestStartTime: Date.now(), connectionId: null,
      apiKey: null, clientRawRequest: {}, reqLogger, trackDone: () => {}, appendLog: () => {},
    });
    expect(result.success).toBe(true);
    expect(await result.response.text()).not.toContain("private upstream thought");
    expect(JSON.stringify(reqLogger.logProviderResponse.mock.calls)).not.toContain("private upstream thought");
  });

  it("clamps a conflicting suffix on a fixed tier to that tier", () => {
    const body = {};
    applyThinking("antigravity", `${model}-high(xhigh)`, body, "antigravity");
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "high", includeThoughts: true });
  });

  it("does not add xhigh to Argon", () => {
    expect(getThinkingLevels("antigravity", "gemini-4-argon-high")).toEqual(["low", "medium", "high"]);
    const body = { reasoning_effort: "xhigh" };
    applyThinking("gemini", "gemini-4-argon", body, "gemini");
    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe("high");
  });
});
