import { describe, it, expect, beforeEach } from "vitest";

import { getRotatedModels, handleComboChat, resetComboRotation } from "../../open-sse/services/combo.js";

const log = {
  info() {},
  warn() {},
};

function sseResponse(events) {
  return new Response(events.join("\n\n"), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("combo round-robin routing", () => {
  beforeEach(() => {
    resetComboRotation();
  });

  it("keeps existing one-request round-robin behavior by default", () => {
    const models = ["provider/model-a", "provider/model-b"];

    const firstChoices = Array.from({ length: 4 }, () => (
      getRotatedModels(models, "code-xhigh", "round-robin")[0]
    ));

    expect(firstChoices).toEqual([
      "provider/model-a",
      "provider/model-b",
      "provider/model-a",
      "provider/model-b",
    ]);
  });

  it("sticks to each combo model for the configured number of requests", () => {
    const models = ["provider/model-a", "provider/model-b"];

    const firstChoices = Array.from({ length: 6 }, () => (
      getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]
    ));

    expect(firstChoices).toEqual([
      "provider/model-a",
      "provider/model-a",
      "provider/model-b",
      "provider/model-b",
      "provider/model-a",
      "provider/model-a",
    ]);
  });

  it("tracks sticky rotation independently per combo", () => {
    const models = ["provider/model-a", "provider/model-b"];

    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-b");
    expect(getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]).toBe("provider/model-a");
  });

  it("does not rotate fallback combos", () => {
    const models = ["provider/model-a", "provider/model-b"];

    expect(getRotatedModels(models, "code-xhigh", "fallback", 2)).toEqual(models);
    expect(getRotatedModels(models, "code-xhigh", "fallback", 2)).toEqual(models);
  });

  it("falls through when a tool-heavy SSE response has no visible output", async () => {
    const tried = [];
    const result = await handleComboChat({
      body: {
        messages: [{ role: "user", content: "echo ok" }],
        tools: [{ name: "Read", input_schema: { type: "object", properties: {} } }],
      },
      models: ["ds/deepseek-v4-pro-max", "minimax/MiniMax-M2.7"],
      log,
      handleSingleModel: async (_body, model) => {
        tried.push(model);
        if (model.startsWith("ds/")) {
          return sseResponse([
            'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[]}}',
            'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
            'event: message_stop\ndata: {"type":"message_stop"}',
            "data: [DONE]",
          ]);
        }
        return sseResponse([
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}',
          "data: [DONE]",
        ]);
      },
    });

    expect(tried).toEqual(["ds/deepseek-v4-pro-max", "minimax/MiniMax-M2.7"]);
    expect(await result.text()).toContain("ok");
  });

  it("does not inspect or fallback empty streams when the request has no tools", async () => {
    const tried = [];
    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "ping" }] },
      models: ["provider/model-a", "provider/model-b"],
      log,
      handleSingleModel: async (_body, model) => {
        tried.push(model);
        return sseResponse(["event: message_stop\ndata: {\"type\":\"message_stop\"}", "data: [DONE]"]);
      },
    });

    expect(tried).toEqual(["provider/model-a"]);
    expect(result.ok).toBe(true);
  });

  it("keeps tool streams that emit tool calls", async () => {
    const tried = [];
    const result = await handleComboChat({
      body: {
        messages: [{ role: "user", content: "read" }],
        tools: [{ name: "Read", input_schema: { type: "object", properties: {} } }],
      },
      models: ["provider/model-a", "provider/model-b"],
      log,
      handleSingleModel: async (_body, model) => {
        tried.push(model);
        return sseResponse([
          'event: content_block_start\ndata: {"type":"content_block_start","content_block":{"type":"tool_use","id":"toolu_1","name":"Read","input":{}}}',
          "data: [DONE]",
        ]);
      },
    });

    expect(tried).toEqual(["provider/model-a"]);
    expect(await result.text()).toContain("tool_use");
  });
});
