// Issues #4637 and #4603 — OpenAI Responses translator regressions
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const R2O = (body) => translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", body, true, null, null);
// Use a model with reasoning capability for Chat→Responses tests
const O2R = (body) => translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "o1-mini", body, true, null, null);

describe("#4637 Responses→Chat: text field must be dropped / mapped", () => {
  it("drops text.verbosity (no chat equivalent)", () => {
    const out = R2O({
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Hi" }] }],
      text: { verbosity: "low" },
    });
    expect(out).not.toHaveProperty("text");
  });

  it("maps text.format (structured output) to chat response_format", () => {
    const out = R2O({
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "JSON only" }] }],
      text: { format: { type: "json_object" } },
    });
    expect(out).not.toHaveProperty("text");
    expect(out).toHaveProperty("response_format");
    expect(out.response_format).toEqual({ type: "json_object" });
  });

  it("maps text.format with json_schema to chat response_format.json_schema", () => {
    const out = R2O({
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Schema" }] }],
      text: { format: { type: "json_schema", name: "test", schema: { type: "object", properties: {} }, strict: true } },
    });
    expect(out).not.toHaveProperty("text");
    expect(out).toHaveProperty("response_format");
    expect(out.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "test", schema: { type: "object", properties: {} }, strict: true },
    });
  });
});

