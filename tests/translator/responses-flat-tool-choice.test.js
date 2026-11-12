// Audit item: the Responses API's flat forced-function tool_choice
// ({ type: "function", name: "Read" }) was passed through untranslated when
// Responses input was converted to chat: the Claude target got { type: "auto" }
// (request/openai-to-claude.js only understands the nested chat form) and the
// OpenAI chat target kept the flat form, which OpenAI rejects. The flat form is
// native to the Responses/Codex wire, so it must survive when that is the
// TARGET.
import { describe, expect, it } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const clone = (v) => structuredClone(v);

const tools = [
  {
    type: "function",
    name: "Read",
    description: "read a file",
    parameters: { type: "object", properties: {} },
  },
];

const responsesBody = () => ({
  model: "gpt-x",
  input: "read the file",
  tools,
  tool_choice: { type: "function", name: "Read" },
});

describe("Responses flat tool_choice", () => {
  it("normalizes the flat form to the nested chat form for the OpenAI target", () => {
    const out = translateRequest(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI,
      "gpt-x",
      clone(responsesBody()),
      true,
      null,
      "openai"
    );
    expect(out.tool_choice).toEqual({ type: "function", function: { name: "Read" } });
  });

  it("maps the flat form to Claude's {type:'tool',name}", () => {
    const out = translateRequest(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.CLAUDE,
      "claude-x",
      clone(responsesBody()),
      true,
      { apiKey: "sk-x" },
      "anthropic-compatible-x"
    );
    expect(out.tool_choice).toEqual({ type: "tool", name: "Read" });
  });

  it("leaves the flat form untouched when the TARGET is the Responses API", () => {
    const out = translateRequest(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI_RESPONSES,
      "gpt-x",
      clone(responsesBody()),
      true,
      null,
      "openai"
    );
    expect(out.tool_choice).toEqual({ type: "function", name: "Read" });
  });

  it("leaves the flat form untouched on the OpenAI→Responses direct route", () => {
    // Already-Responses bodies (body.input) short-circuit in
    // openaiToOpenAIResponsesRequest; the flat form is native there.
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      "gpt-x",
      clone(responsesBody()),
      true,
      null,
      "openai"
    );
    expect(out.tool_choice).toEqual({ type: "function", name: "Read" });
  });

  it("keeps the nested chat form working for the Claude target (control)", () => {
    const body = {
      model: "gpt-x",
      input: "read the file",
      tools,
      tool_choice: { type: "function", function: { name: "Read" } },
    };
    const out = translateRequest(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.CLAUDE,
      "claude-x",
      clone(body),
      true,
      { apiKey: "sk-x" },
      "anthropic-compatible-x"
    );
    expect(out.tool_choice).toEqual({ type: "tool", name: "Read" });
  });
});
