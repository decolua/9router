/**
 * Regression: a Responses function_call_output whose output is a content array
 * with input_image (e.g. a browser screenshot from Codex) was JSON-stringified
 * into the tool message, so the base64 reached the model as text tokens — one
 * screenshot could push a Claude prompt past its 1M-token limit.
 */
import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const B64 = "iVBORw0KGgo=";
const PNG = `data:image/png;base64,${B64}`;

function screenshotBody(extraInput = []) {
  return {
    model: "claude-opus",
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "take a screenshot" }] },
      { type: "function_call", call_id: "c1", name: "screenshot", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output: [
        { type: "input_text", text: "captured" },
        { type: "input_image", image_url: PNG },
      ] },
      ...extraInput,
    ],
  };
}

describe("Responses function_call_output with input_image", () => {
  it("keeps image base64 out of the OpenAI tool message text", () => {
    const out = openaiResponsesToOpenAIRequest("m", screenshotBody(), false);
    const toolIdx = out.messages.findIndex(m => m.role === "tool");

    expect(out.messages[toolIdx]).toEqual({ role: "tool", tool_call_id: "c1", content: "captured" });
    expect(out.messages[toolIdx + 1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "[Image from tool result c1]" },
        { type: "image_url", image_url: { url: PNG, detail: "auto" } },
      ],
    });
  });

  it("places tool images after the whole run of parallel tool results", () => {
    const body = screenshotBody();
    body.input.splice(2, 0, { type: "function_call", call_id: "c2", name: "read", arguments: "{}" });
    body.input.push({ type: "function_call_output", call_id: "c2", output: "file text" });

    const roles = openaiResponsesToOpenAIRequest("m", body, false).messages.map(m => m.role);
    expect(roles).toEqual(["user", "assistant", "tool", "tool", "user"]);
  });

  it("sends the screenshot to Claude as an image block, not text", () => {
    const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, "claude-opus", screenshotBody(), false);
    const serialized = JSON.stringify(out.messages);

    expect(serialized).not.toContain(`"text":"${PNG}`);
    expect(serialized).not.toContain("input_image");
    const blocks = out.messages.flatMap(m => (Array.isArray(m.content) ? m.content : []));
    expect(blocks.find(b => b.type === "tool_result")).toMatchObject({ tool_use_id: "c1", content: "captured" });
    expect(blocks.find(b => b.type === "image")).toMatchObject({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: B64 },
    });
  });

  it("never leaves an image-only tool result empty", () => {
    const body = screenshotBody();
    body.input[2].output = [{ type: "input_image", image_url: PNG }];
    const out = openaiResponsesToOpenAIRequest("m", body, false);
    expect(out.messages.find(m => m.role === "tool").content).toBe("[image attached in next message]");
  });

  it("leaves string tool output unchanged", () => {
    const body = screenshotBody();
    body.input[2].output = "plain";
    const out = openaiResponsesToOpenAIRequest("m", body, false);
    expect(out.messages.at(-1)).toEqual({ role: "tool", tool_call_id: "c1", content: "plain" });
  });
});
