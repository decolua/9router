import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const T = (src, tgt, body, stream = true) =>
  translateRequest(src, tgt, "m", body, stream, null);

describe("openai→responses request: stream arg respected", () => {
  it("undefined stream keeps historical streaming default (stream:true)", () => {
    const out = T(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, { messages: [{ role: "user", content: "hi" }] });
    expect(out.stream).toBe(true);
  });

  it("stream:false propagates false", () => {
    const out = T(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, { messages: [{ role: "user", content: "hi" }] }, false);
    expect(out.stream).toBe(false);
  });

  it("body.input fast path: undefined stream keeps streaming default", () => {
    const out = T(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }] });
    expect(out.stream).toBe(true);
  });

  it("body.input fast path: stream:false stays false", () => {
    const out = T(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }], stream: false }, false);
    expect(out.stream).toBe(false);
  });
});

describe("openai→responses request: tool_choice normalization", () => {
  it("string auto/none/required pass through", () => {
    for (const choice of ["auto", "none", "required"]) {
      const out = T(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, { messages: [], tool_choice: choice });
      expect(out.tool_choice).toBe(choice);
    }
  });

  it("named OpenAI Chat shape {type:function,function:{name}} → {type:function,name}", () => {
    const out = T(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, {
      messages: [],
      tools: [{ type: "function", function: { name: "shell", parameters: {} } }],
      tool_choice: { type: "function", function: { name: "shell" } },
    });
    expect(out.tool_choice).toEqual({ type: "function", name: "shell" });
  });

  it("named Responses shape {type:function,name} passes through", () => {
    const out = T(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, {
      messages: [],
      tool_choice: { type: "function", name: "shell" },
    });
    expect(out.tool_choice).toEqual({ type: "function", name: "shell" });
  });

  it("Claude any → required via actual translateRequest claude→responses", () => {
    const out = T(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, {
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "shell", description: "d", input_schema: { type: "object", properties: {} } }],
      tool_choice: { type: "any" },
    });
    expect(out.tool_choice).toBe("required");
  });

  it("Claude named tool {type:tool,name} → {type:function,name}", () => {
    const out = T(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, {
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "shell", description: "d", input_schema: { type: "object", properties: {} } }],
      tool_choice: { type: "tool", name: "shell" },
    });
    expect(out.tool_choice).toEqual({ type: "function", name: "shell" });
  });

  it("unknown hosted-tool shapes are preserved, not deleted", () => {
    const out = T(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, {
      messages: [],
      tool_choice: { type: "web_search" },
    });
    expect(out.tool_choice).toEqual({ type: "web_search" });
  });
});

describe("openai→responses request: token field precedence", () => {
  it("max_output_tokens wins over max_completion_tokens and max_tokens", () => {
    const out = T(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, {
      messages: [],
      max_tokens: 100,
      max_completion_tokens: 200,
      max_output_tokens: 300,
    });
    expect(out.max_output_tokens).toBe(300);
    expect(out.max_tokens).toBeUndefined();
    expect(out.max_completion_tokens).toBeUndefined();
  });

  it("max_completion_tokens beats max_tokens when no max_output_tokens", () => {
    const out = T(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, {
      messages: [],
      max_tokens: 100,
      max_completion_tokens: 200,
    });
    expect(out.max_output_tokens).toBe(200);
    expect(out.max_completion_tokens).toBeUndefined();
  });

  it("max_tokens alone maps to max_output_tokens", () => {
    const out = T(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, { messages: [], max_tokens: 128 });
    expect(out.max_output_tokens).toBe(128);
    expect(out.max_tokens).toBeUndefined();
  });

  it("body.input fast path deletes legacy token fields", () => {
    const out = T(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, {
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      model: "gpt-x",
      max_tokens: 111,
      max_completion_tokens: 222,
      max_output_tokens: 333,
    });
    expect(out.max_output_tokens).toBe(333);
    expect(out.max_tokens).toBeUndefined();
    expect(out.max_completion_tokens).toBeUndefined();
    // model override preserved
    expect(out.model).toBe("gpt-x");
    // input preserved verbatim
    expect(out.input).toEqual([{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }]);
  });
});
