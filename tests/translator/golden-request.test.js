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

// Khử field động: toolNameMap, uuid phiên (kiro), timestamp trong content.
// conversationId và agentContinuationId đều là crypto.randomUUID() cho một request
// ephemeral (utils/sessionManager.js:224) — đổi mỗi lần chạy. Thay bằng placeholder
// thay vì xoá hẳn, để golden vẫn bắt được nếu một field biến mất.
const UUID_KEYS = new Set(["conversationId", "agentContinuationId"]);

function clean(body) {
  const s = JSON.stringify(body, (k, v) => {
    if (k === "_toolNameMap") return undefined;
    if (UUID_KEYS.has(k)) return "<UUID>";
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

  it("Gemini CLI tool requests include validated toolConfig and enough output for high thinking", () => {
    const body = {
      messages: [{ role: "user", content: "Call add with 7 and 35." }],
      tools: [
        {
          type: "function",
          function: {
            name: "add",
            description: "Add two numbers",
            parameters: {
              type: "object",
              properties: {
                a: { type: "number" },
                b: { type: "number" },
              },
              required: ["a", "b"],
            },
          },
        },
      ],
      reasoning_effort: "high",
      max_tokens: 128,
    };
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.GEMINI_CLI,
      "gemini-3.1-pro-preview",
      body,
      true,
      { accessToken: "t", projectId: "p" },
      "gemini-cli"
    );

    expect(out.request.toolConfig).toEqual({ functionCallingConfig: { mode: "VALIDATED" } });
    expect(out.request.safetySettings).toBeDefined();
    expect(out.request.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "high", includeThoughts: true });
    expect(out.request.generationConfig.maxOutputTokens).toBe(65535);
  });
});

describe("GOLDEN request: OpenAI → Kiro", () => {
  it("full body (image base64 + tool_result)", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.KIRO, "claude-sonnet-4.5", baseBody(), true, { accessToken: "t" }, "kiro");
    expect(clean(out)).toMatchSnapshot();
  });
});

// Một golden chỉ là golden nếu cùng input cho ra cùng output ở hai lần chạy.
// Kiro đóng dấu hai uuid mới vào mọi request ephemeral; clean() trước đây chỉ khử
// một, nên snapshot của "OpenAI → Kiro" không thể khớp ở bất kỳ lần chạy nào —
// regenerate chỉ đẩy lỗi sang lần sau với một uuid khác.
describe("GOLDEN request: reproducibility", () => {
  const CASES = [
    ["OpenAI → Claude", FORMATS.CLAUDE, "claude-opus-4-6", { apiKey: "sk-x" }, "claude"],
    ["OpenAI → Gemini", FORMATS.GEMINI, "gemini-3-pro", { apiKey: "k" }, "gemini"],
    ["OpenAI → Kiro", FORMATS.KIRO, "claude-sonnet-4.5", { accessToken: "t" }, "kiro"],
  ];

  for (const [name, to, model, creds, provider] of CASES) {
    it(`${name} → identical output on two runs`, () => {
      const once = clean(translateRequest(FORMATS.OPENAI, to, model, baseBody(), true, creds, provider));
      const twice = clean(translateRequest(FORMATS.OPENAI, to, model, baseBody(), true, creds, provider));
      expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    });
  }

  it("cleaned Kiro body carries no raw uuid", () => {
    const out = clean(translateRequest(FORMATS.OPENAI, FORMATS.KIRO, "claude-sonnet-4.5", baseBody(), true, { accessToken: "t" }, "kiro"));
    const raw = JSON.stringify(out).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g);
    expect(raw).toBeNull();
  });
});
