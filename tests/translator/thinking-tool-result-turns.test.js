import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

function toolTurn(config = {}) {
  return {
    messages: [
      { role: "user", content: "Look up the weather" },
      { role: "assistant", content: null, tool_calls: [
        { id: "call_1", type: "function", function: { name: "weather", arguments: "{}" } },
      ] },
      { role: "tool", tool_call_id: "call_1", content: "sunny" },
    ],
    tools: [{ type: "function", function: { name: "weather", parameters: { type: "object", properties: {} } } }],
    max_tokens: 32000,
    ...config,
  };
}

const translate = (model, body, source = FORMATS.OPENAI) =>
  translateRequest(source, FORMATS.CLAUDE, model, body, true, null, "claude");

describe("thinking intent on OpenAI tool-result turns", () => {
  it("keeps an explicit budget through the complete Claude translation", () => {
    const out = translate("claude-haiku-4.5", toolTurn({ thinking: { type: "enabled", budget_tokens: 4096 } }));
    expect(out.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
    expect(out.messages.at(-1)).toMatchObject({ role: "user", content: [
      { type: "tool_result", tool_use_id: "call_1", content: "sunny" },
    ] });
  });

  it("keeps adaptive thinking on a model with an optional thinking switch", () => {
    const out = translate("claude-opus-4.7", toolTurn({ thinking: { type: "adaptive" } }));
    expect(out.thinking).toEqual({ type: "adaptive" });
    expect(out.output_config).toEqual({ effort: "high" });
  });

  it("maps a budget to effort on permanently adaptive models", () => {
    const out = translate("claude-opus-5-5", toolTurn({ thinking: { type: "enabled", budget_tokens: 10000 } }));
    expect(out.output_config).toEqual({ effort: "medium" });
    expect(out.thinking).toBeUndefined();
  });

  it("keeps reasoning_effort working without a thinking object", () => {
    const out = translate("claude-haiku-4.5", toolTurn({ reasoning_effort: "high" }));
    expect(out.thinking).toEqual({ type: "enabled", budget_tokens: 24576, display: "summarized" });
  });

  it("does not invent thinking intent for an ordinary tool result", () => {
    const out = translate("claude-haiku-4.5", toolTurn());
    expect(out.thinking).toBeUndefined();
    expect(out.output_config).toBeUndefined();
  });

  it("keeps Claude-format user tool results working", () => {
    const out = translate("claude-haiku-4.5", {
      messages: [
        { role: "user", content: "Look up the weather" },
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "weather", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "sunny" }] },
      ],
      tools: [{ name: "weather", input_schema: { type: "object", properties: {} } }],
      thinking: { type: "enabled", budget_tokens: 4096 },
      max_tokens: 32000,
    }, FORMATS.CLAUDE);
    expect(out.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
  });
});
