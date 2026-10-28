// Regression: a Responses `function_call_output` may carry an array of content
// parts, and Codex uses that for screenshots returned by image tools. The
// responses→chat translator used to JSON.stringify the whole array into the
// `tool` message, which turned each screenshot into ~380KB of base64 *text*.
// Upstream tokenizers bill that as text (~1.5 chars/token), so two screenshots
// added ~500K tokens and pushed a 1M-context request over the limit with
// HTTP 400 "maximum context length". Text must stay in the tool message and
// images must travel as image parts in a following user turn.
import { describe, expect, it } from "vitest";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// 1x1 transparent PNG — only the shape of the payload matters in these tests.
const IMAGE_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const makeBody = (output) => ({
  model: "deepseek-v4-flash",
  input: [
    { type: "message", role: "user", content: [{ type: "input_text", text: "look at the screenshot" }] },
    { type: "function_call", call_id: "call_1", name: "view_image", arguments: "{}" },
    { type: "function_call_output", call_id: "call_1", output },
  ],
});

const translate = (output) => openaiResponsesToOpenAIRequest("deepseek-v4-flash", makeBody(output), true, null);
const findImageTurn = (messages) =>
  messages.find((m) => m.role === "user" && Array.isArray(m.content) && m.content.some((c) => c.type === "image_url"));

describe("Responses tool output with image content parts", () => {
  it("keeps text in the tool message and re-attaches images as a user turn", () => {
    const out = translate([
      { type: "input_image", image_url: IMAGE_URL, detail: "high" },
      { type: "input_text", text: "screenshot attached" },
    ]);

    const toolMsg = out.messages.find((m) => m.role === "tool");
    expect(toolMsg).toMatchObject({ tool_call_id: "call_1", content: "screenshot attached" });

    // The base64 payload must never end up inside the tool message text.
    expect(toolMsg.content).not.toContain("base64");

    const imageTurn = findImageTurn(out.messages);
    expect(imageTurn).toBeTruthy();
    expect(imageTurn.content).toEqual([
      { type: "text", text: "[images returned by the tool result above]" },
      { type: "image_url", image_url: { url: IMAGE_URL, detail: "high" } },
    ]);
    // The image turn must follow its tool result, so tool_call_id pairing holds.
    expect(out.messages.indexOf(imageTurn)).toBe(out.messages.indexOf(toolMsg) + 1);
  });

  it("understands chat-shaped image_url parts too", () => {
    const out = translate([
      { type: "image_url", image_url: { url: IMAGE_URL, detail: "low" } },
    ]);

    expect(out.messages.find((m) => m.role === "tool").content).toBe("[tool returned images - see the next message]");
    expect(findImageTurn(out.messages).content.at(-1)).toEqual({
      type: "image_url",
      image_url: { url: IMAGE_URL, detail: "low" },
    });
  });

  it("drops an image part without a payload but keeps the text", () => {
    const out = translate([
      { type: "input_image" },
      { type: "input_text", text: "capture failed" },
    ]);

    expect(out.messages.find((m) => m.role === "tool").content).toBe("[image omitted: missing image payload]\ncapture failed");
    expect(findImageTurn(out.messages)).toBeUndefined();
  });

  it("leaves plain string outputs untouched", () => {
    const out = translate("plain text result");

    expect(out.messages.find((m) => m.role === "tool").content).toBe("plain text result");
    expect(findImageTurn(out.messages)).toBeUndefined();
    expect(out.messages.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("keeps the old JSON shape for arrays that are not content parts", () => {
    const out = translate([1, 2]);

    expect(out.messages.find((m) => m.role === "tool").content).toBe("[1,2]");
    expect(findImageTurn(out.messages)).toBeUndefined();
  });
});

describe("DeepSeek capability table", () => {
  it("treats the DeepSeek API's Flash models as vision models", () => {
    for (const model of ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"]) {
      expect(getCapabilitiesForModel("deepseek", model)).toMatchObject({
        vision: true,
        reasoning: true,
        thinkingFormat: "deepseek",
        contextWindow: 1000000,
        maxOutput: 384000,
      });
    }
  });

  it("keeps deepseek-v4-pro text-only", () => {
    expect(getCapabilitiesForModel("deepseek", "deepseek-v4-pro").vision).toBe(false);
  });
});
