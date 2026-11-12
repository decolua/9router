// Codex view_image / screenshot tool outputs: function_call_output.output is a
// content array with input_image parts. Stringifying it sent base64 as text and
// blew past Claude's 1M-token limit ("prompt is too long: 2714164 tokens").
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { convertResponsesApiFormat } from "../../open-sse/translator/formats/responsesApi.js";

const B64 = "A".repeat(200000);
const body = () => ({
  model: "m",
  input: [
    { type: "message", role: "user", content: [{ type: "input_text", text: "look" }] },
    { type: "function_call", call_id: "c1", name: "view_image", arguments: "{}" },
    { type: "function_call", call_id: "c2", name: "shell", arguments: "{}" },
    { type: "function_call_output", call_id: "c1", output: [{ type: "input_image", image_url: `data:image/png;base64,${B64}`, detail: "high" }] },
    { type: "function_call_output", call_id: "c2", output: "ok" },
    { type: "message", role: "user", content: [{ type: "input_text", text: "next" }] },
  ],
});

function assertImageNotText(messages) {
  const tools = messages.filter((m) => m.role === "tool");
  expect(tools.map((m) => m.tool_call_id)).toEqual(["c1", "c2"]);
  expect(JSON.stringify(tools)).not.toContain(B64);
  const asstIdx = messages.findIndex((m) => m.tool_calls);
  expect(messages[asstIdx + 1].role).toBe("tool");
  expect(messages[asstIdx + 2].role).toBe("tool");
  const img = messages[asstIdx + 3];
  expect(img.role).toBe("user");
  expect(img.content.find((c) => c.type === "image_url").image_url.url).toContain(B64);
}

describe("Responses tool output with input_image", () => {
  it("translator path: image becomes an image block, not tool text", () => {
    assertImageNotText(translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", body(), true, null, null).messages);
  });

  it("responsesHandler path: image becomes an image block, not tool text", () => {
    assertImageNotText(convertResponsesApiFormat(body()).messages);
  });

  it("reaches Claude as a base64 image block", () => {
    const openai = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", body(), true, null, null);
    const claude = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "m", openai, true, null, null);
    const blocks = claude.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
    const results = blocks.filter((b) => b.type === "tool_result");
    expect(JSON.stringify(results)).not.toContain(B64);
    expect(blocks.some((b) => b.type === "image" && b.source?.data === B64)).toBe(true);
  });
});
