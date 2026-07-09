// P0 GOLDEN: lock OUTPUT của translateRequest (body) cho các đích đặc biệt.
// openai → claude/gemini/kiro: thinking, tools, image, system, tool_result.
// Sau refactor chạy lại phải khớp y hệt.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Body openai mẫu phủ nhiều concern (text, image, tool, tool_result, system, thinking).
function baseBody() {
  return {
    messages: [
      { role: "system", content: "You are helpful." },
      { role: "user", content: [
        { type: "text", text: "What's in this image?" },
        { type: "image_url", image_url: { url: "data:image/png;base64,IMGDATA", detail: "high" } },
      ] },
      { role: "assistant", content: "", tool_calls: [
        { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"NYC"}' } },
      ] },
      { role: "tool", tool_call_id: "call_1", content: "sunny" },
    ],
    tools: [
      { type: "function", function: { name: "get_weather", description: "Get weather", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } } },
    ],
    temperature: 0.7,
  };
}

// Khử field động: toolNameMap, kiro conversationId (uuid), timestamp trong content.
function clean(body) {
  const s = JSON.stringify(body, (k, v) => {
    if (k === "_toolNameMap" || k === "conversationId") return undefined;
    return v;
  }).replace(/Current time is [^"\\]+/g, "Current time is <TS>");
  return JSON.parse(s);
}

describe("GOLDEN request: OpenAI → Claude", () => {
  it("full body (system/image/tool/tool_result)", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-opus-4-6", baseBody(), true, { apiKey: "sk-x" }, "claude");
    expect(clean(out)).toMatchSnapshot();
  });

  it("reasoning_effort → adaptive output_config (claude 4.6+)", () => {
    const body = { messages: [{ role: "user", content: "hi" }], reasoning_effort: "high" };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-opus-4-6", body, true, { apiKey: "sk-x" }, "anthropic");
    expect(clean(out)).toMatchSnapshot();
  });
});

describe("GOLDEN request: OpenAI → Gemini", () => {
  it("full body (system/image/tool/tool_result)", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.GEMINI, "gemini-3-pro", baseBody(), true, { apiKey: "k" }, "gemini");
    expect(clean(out)).toMatchSnapshot();
  });
});

describe("GOLDEN request: OpenAI → Kiro", () => {
  it("full body (image base64 + tool_result)", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.KIRO, "claude-sonnet-4.5", baseBody(), true, { accessToken: "t" }, "kiro");
    expect(clean(out)).toMatchSnapshot();
  });
});
