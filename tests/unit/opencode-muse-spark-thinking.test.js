import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { PROVIDER_MODELS, getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";

const MODEL = "muse-spark-1.2-contributor-free";
const PROVIDER = "opencode";

const input = [{
  type: "message",
  role: "user",
  content: [{ type: "input_text", text: "Think, then answer: 2 + 2?" }],
}];

describe("OpenCode Free Muse Spark thinking", () => {
  it("advertises reasoning and the requested model limits", () => {
    expect(PROVIDER_MODELS.oc?.some((model) => model.id === MODEL)).toBe(true);
    expect(PROVIDER_MODELS.oc?.some((model) => model.id === "muse-spark-1.3-contributor-free")).toBe(true);
    for (const m of [MODEL, "muse-spark-1.3-contributor-free", "muse-spark-1.4-contributor-free", "muse-spark-2.0-contributor-free"]) {
      expect(getCapabilitiesForModel(PROVIDER, m)).toMatchObject({
        reasoning: true,
        thinkingFormat: "openai",
        contextWindow: 1048576,
        maxOutput: 131072,
      });
      expect(getCapabilitiesForModel(PROVIDER, `oc/${m}`)).toMatchObject({
        reasoning: true,
        contextWindow: 1048576,
        maxOutput: 131072,
      });
      expect(getThinkingLevels(PROVIDER, m)).toEqual([
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
      ]);
      expect(getModelTargetFormat("oc", m)).toBe(FORMATS.OPENAI_RESPONSES);
      expect(getModelTargetFormat("opencode", m)).toBe(FORMATS.OPENAI_RESPONSES);
      expect(getModelTargetFormat("openrouter", m)).toBeNull();
    }
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

  it("no longer offers Union Alpha and sends every remaining free model to a live endpoint", () => {
    const freeModels = PROVIDER_MODELS.oc || [];
    expect(freeModels.some((model) => model.id === "union-alpha")).toBe(false);
    expect(freeModels.some((model) => model.id === "union-alpha-free")).toBe(false);

    // With the Claude Messages path gone, the only two upstreams left are
    // chat/completions for plain chat models and /responses for Muse Spark.
    const executor = new OpenCodeExecutor();
    for (const model of freeModels) {
      const url = executor.buildUrl(model.id);
      expect([
        "https://opencode.ai/zen/v1/chat/completions",
        "https://opencode.ai/zen/v1/responses",
      ]).toContain(url);
      expect(executor.buildHeaders({}, true)).not.toHaveProperty("anthropic-version");
    }
  });

  it("leaves the other free models on Chat Completions", () => {
    const executor = new OpenCodeExecutor();
    const body = { messages: [{ role: "user", content: "hi" }], max_tokens: 1024 };
    executor.transformRequest("big-pickle", body, true, {});
    expect(executor.buildUrl("big-pickle")).toBe("https://opencode.ai/zen/v1/chat/completions");
    expect(body.max_tokens).toBe(1024);
    expect(body.max_output_tokens).toBeUndefined();
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

  it("routes muse-spark-1.3-contributor-free and future Muse Spark models to Responses API", () => {
    const executor = new OpenCodeExecutor();
    const futureModel = "muse-spark-1.4-contributor-free";

    for (const m of ["muse-spark-1.3-contributor-free", futureModel]) {
      expect(executor.buildUrl(m)).toBe("https://opencode.ai/zen/v1/responses");
      expect(executor.buildUrl(`${m}(high)`)).toBe("https://opencode.ai/zen/v1/responses");
      expect(getModelTargetFormat("oc", m)).toBe("openai-responses");

      const body = {
        model: `oc/${m}`,
        messages: [{ role: "user", content: "Hello" }],
        reasoning_effort: "high",
        max_tokens: 2048,
      };

      const translated = translateRequest(
        FORMATS.OPENAI,
        FORMATS.OPENAI_RESPONSES,
        m,
        body,
        true,
        {},
        PROVIDER,
      );
      const out = executor.transformRequest(m, translated, true, {
        connectionId: "opencode-muse-spark-13-test",
      });

      expect(out.reasoning).toEqual({ effort: "high", summary: "auto" });
      expect(out.max_output_tokens).toBe(2048);
      expect(out.max_tokens).toBeUndefined();
    }
  });

  it("strips prior-turn reasoning items carrying encrypted_content from input", () => {
    const executor = new OpenCodeExecutor();
    const model = "muse-spark-1.3-contributor-free";
    const body = {
      model,
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "say hi" }] },
        {
          type: "reasoning",
          id: "rs_123",
          encrypted_content: "ENC_BLOB_TURN_1",
          summary: [{ type: "summary_text", text: "thinking text" }],
        },
        {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "shell",
          arguments: JSON.stringify({ command: "echo hi" }),
        },
        {
          type: "function_call_output",
          call_id: "call_1",
          output: "hi",
        },
        { type: "message", role: "user", content: [{ type: "input_text", text: "now say bye" }] },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "shell",
            description: "Run shell command",
            parameters: { type: "object" },
          },
        },
      ],
    };

    const out = executor.transformRequest(model, body, true, {});
    expect(out.stream).toBe(true);
    expect(out.store).toBe(false);
    // Prior reasoning items stripped to prevent 400 "reasoning encrypted_content was not issued to this caller"
    expect(out.input.some((item) => item.type === "reasoning")).toBe(false);
    expect(JSON.stringify(out.input)).not.toContain("ENC_BLOB_TURN_1");
    // User message, function_call, function_call_output, and next user message survive
    const types = out.input.map((item) => item.type);
    expect(types).toEqual(["message", "function_call", "function_call_output", "message"]);
    // Tools flattened and empty properties added
    expect(out.tools).toEqual([
      {
        type: "function",
        name: "shell",
        description: "Run shell command",
        parameters: { type: "object", properties: {} },
      },
    ]);
  });
});
