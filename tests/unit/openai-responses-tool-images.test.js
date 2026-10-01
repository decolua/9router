import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

const MODEL = "gpt-5.6-luna";
const DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";

function toolHistory(content, callId = "call_read") {
  return {
    messages: [
      { role: "user", content: "Read the image and describe it." },
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: callId,
          type: "function",
          function: { name: "read", arguments: '{"path":"image.png"}' },
        }],
      },
      { role: "tool", tool_call_id: callId, content },
    ],
  };
}

describe("OpenAI tool-result images on Responses requests (#3864)", () => {
  it.each([
    [
      "Chat image_url object",
      { type: "image_url", image_url: { url: DATA_URI, detail: "high" } },
      { type: "input_image", image_url: DATA_URI, detail: "high" },
    ],
    [
      "Chat image_url string",
      { type: "image_url", image_url: "https://example.com/image.png" },
      { type: "input_image", image_url: "https://example.com/image.png", detail: "auto" },
    ],
    [
      "Responses input_image",
      { type: "input_image", image_url: DATA_URI, detail: "low" },
      { type: "input_image", image_url: DATA_URI, detail: "low" },
    ],
  ])("preserves %s as visual input after the tool output", (_label, image, expected) => {
    const body = toolHistory([
      { type: "text", text: "Image read successfully. " },
      image,
      { type: "text", text: "Inspect the center." },
    ]);
    const original = structuredClone(body);
    const out = openaiToOpenAIResponsesRequest(MODEL, body, true, null);

    expect(out.input.slice(2)).toEqual([
      { type: "function_call_output", call_id: "call_read", output: "Image read successfully. Inspect the center." },
      { type: "message", role: "user", content: [expected] },
    ]);
    expect(body).toEqual(original);
  });

  it("keeps image-only output paired and preserves multiple images in order", () => {
    const images = [
      { type: "image_url", image_url: { url: DATA_URI } },
      { type: "input_image", file_id: "file-second-image", detail: "high" },
    ];
    const longId = `call_${"x".repeat(80)}`;
    const out = openaiToOpenAIResponsesRequest(MODEL, toolHistory(images, longId), true, null);

    expect(out.input[2]).toEqual({
      type: "function_call_output", call_id: out.input[1].call_id, output: "",
    });
    expect(out.input[2].call_id).toHaveLength(64);
    expect(out.input[3]).toEqual({
      type: "message", role: "user", content: [
        { type: "input_image", image_url: DATA_URI, detail: "auto" },
        images[1],
      ],
    });
  });

  it("preserves tool-call pairing and image order for parallel results", () => {
    const body = toolHistory([{ type: "image_url", image_url: { url: DATA_URI } }]);
    body.messages[1].tool_calls.push({
      id: "call_second", type: "function", function: { name: "read", arguments: "{}" },
    });
    body.messages.push({
      role: "tool", tool_call_id: "call_second",
      content: [{ type: "input_image", image_url: "https://example.com/second.png" }],
    });
    const out = openaiToOpenAIResponsesRequest(MODEL, body, true, null);

    expect(out.input.filter((item) => item.type === "function_call_output")).toEqual([
      { type: "function_call_output", call_id: "call_read", output: "" },
      { type: "function_call_output", call_id: "call_second", output: "" },
    ]);
    expect(out.input.filter((item) => item.role === "user").slice(1).map((item) => item.content[0].image_url))
      .toEqual([DATA_URI, "https://example.com/second.png"]);
  });

  it.each([
    ["plain string", "done", "done"],
    ["empty output", null, ""],
    ["JSON object", { ok: true }, '{"ok":true}'],
    ["text parts", [{ type: "text", text: "a" }, { type: "text", text: "b" }], "ab"],
    ["unknown block", [{ type: "custom", value: 7 }], '{"type":"custom","value":7}'],
  ])("does not change %s tool outputs or add a user turn", (_label, content, expected) => {
    const out = openaiToOpenAIResponsesRequest(MODEL, toolHistory(content), true, null);
    expect(out.input).toHaveLength(3);
    expect(out.input[2]).toEqual({ type: "function_call_output", call_id: "call_read", output: expected });
  });

  it("keeps native user images and already-Responses requests unchanged", () => {
    const image = { type: "image_url", image_url: { url: DATA_URI, detail: "high" } };
    const out = openaiToOpenAIResponsesRequest(MODEL, { messages: [{ role: "user", content: [image] }] }, true, null);
    expect(out.input).toEqual([{
      type: "message", role: "user", content: [{ type: "input_image", image_url: DATA_URI, detail: "high" }],
    }]);
    const again = openaiToOpenAIResponsesRequest(MODEL, out, true, null);
    expect(again.input).toEqual(out.input);
  });

  it("retains visual input through the registry and Codex request normalization", async () => {
    const body = toolHistory([
      { type: "text", text: "Image read successfully" },
      { type: "image_url", image_url: { url: DATA_URI } },
    ]);
    const translated = translateRequest("openai", "openai-responses", MODEL, body, true, {}, "codex");
    const executor = new CodexExecutor();
    // Data URI only: prefetch performs no network request and no credentials are used.
    await executor.prefetchImages(translated);
    const out = executor.transformRequest(MODEL, translated, true, {});

    expect(out.input.filter((item) => item.role === "user")).toHaveLength(2);
    expect(out.input.at(-1)).toEqual({
      type: "message", role: "user", content: [{ type: "input_image", image_url: DATA_URI, detail: "auto" }],
    });
    expect(out.input.find((item) => item.type === "function_call_output").output).toBe("Image read successfully");
  });
});
