import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

const MODEL = "muse-spark-1.2-contributor-free";
const MODEL_13 = "muse-spark-1.3-contributor-free";
const PROVIDER = "opencode";

const input = [{
  type: "message",
  role: "user",
  content: [{ type: "input_text", text: "Think, then answer: 2 + 2?" }],
}];

describe("OpenCode Free Muse Spark thinking", () => {
  it("advertises reasoning and the requested model limits", () => {
    expect(PROVIDER_MODELS.oc?.some((model) => model.id === MODEL)).toBe(true);
    expect(getCapabilitiesForModel(PROVIDER, MODEL)).toMatchObject({
      reasoning: true,
      thinkingFormat: "openai",
      contextWindow: 1048576,
      maxOutput: 131072,
    });
    expect(getCapabilitiesForModel(PROVIDER, `oc/${MODEL}`)).toMatchObject({
      reasoning: true,
      contextWindow: 1048576,
      maxOutput: 131072,
    });
    expect(getThinkingLevels(PROVIDER, MODEL)).toEqual([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  it("clamps max to xhigh and emits the Responses reasoning shape", () => {
    const body = {
      input,
      reasoning: { effort: "max" },
      max_tokens: 131072,
    };

    const out = new OpenCodeExecutor().transformRequest(MODEL, body, true, {
      connectionId: "opencode-muse-spark-test",
    });

    expect(out.reasoning).toEqual({ effort: "xhigh", summary: "auto" });
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.max_output_tokens).toBe(131072);
    expect(out.max_tokens).toBeUndefined();
  });

  it("leaves the other free models on Chat Completions", () => {
    const executor = new OpenCodeExecutor();
    const body = { messages: [{ role: "user", content: "hi" }], max_tokens: 1024 };
    executor.transformRequest("big-pickle", body, true, {});
    expect(executor.buildUrl("big-pickle")).toBe("https://opencode.ai/zen/v1/chat/completions");
    expect(body.max_tokens).toBe(1024);
    expect(body.max_output_tokens).toBeUndefined();
  });

  it("recognizes the 1.3 free id (plain and with a suffix) on /responses with the same cap/reasoning logic", () => {
    const executor = new OpenCodeExecutor();
    const target = executor.buildUrl(MODEL_13);
    expect(target).toBe("https://opencode.ai/zen/v1/responses");
    expect(executor.buildUrl(`${MODEL_13}(high)`)).toBe(target);
    const body = { max_tokens: 4096, reasoning_effort: "high" };
    executor.transformRequest(MODEL_13, body, true, {});
    expect(body.max_output_tokens).toBe(4096);
    expect(body.reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(body.max_tokens).toBeUndefined();
  });

  it("translates Chat Completions max thinking into a Responses request", () => {
    const body = {
      model: `oc/${MODEL}`,
      messages: [{ role: "user", content: "Think, then answer: 2 + 2?" }],
      reasoning_effort: "max",
      max_tokens: 131072,
    };

    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      MODEL,
      body,
      true,
      {},
      PROVIDER,
    );
    const out = new OpenCodeExecutor().transformRequest(MODEL, translated, true, {
      connectionId: "opencode-muse-spark-translation-test",
    });

    expect(out.reasoning).toEqual({ effort: "xhigh", summary: "auto" });
    expect(out.max_output_tokens).toBe(131072);
    expect(out.max_tokens).toBeUndefined();
  });

  it("clamps 1.3 none/off suffix intent to minimal instead of sending a disable the API 400s on", () => {
    for (const suffix of ["none", "off"]) {
      const body = {};
      applyThinking("openai-responses", `${MODEL_13}(${suffix})`, body, PROVIDER);
      // 1.3 (thinkingCanDisable:false) must NOT emit a "none" effort; it clamps to the floor.
      expect(body.reasoning_effort).toBe("minimal");
      expect(body.reasoning).toBeUndefined();
      expect(body.thinking).toBeUndefined();
    }
  });

  it.each([
    { reasoning_effort: "none" },
    { reasoning: { effort: "none" } },
  ])("clamps body-field 1.3 disable intent (%o) to minimal — no disable shape on the wire", (fields) => {
    const body = { ...fields };
    applyThinking("openai-responses", MODEL_13, body, PROVIDER);
    expect(body.reasoning_effort).toBe("minimal");
    expect(body.reasoning).toBeUndefined();
    expect(body.thinking).toBeUndefined();
  });
});
