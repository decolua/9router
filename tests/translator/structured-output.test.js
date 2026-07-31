// Structured Output must survive the Chat ⇄ Responses translation (Codex/cx path).
// Regression: response_format was silently dropped, so json_schema never reached the provider.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const R2O = (body) => translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", body, true, null, null);
const O2R = (body) => translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "m", body, true, null, null);

const SCHEMA = { type: "object", properties: { facts: { type: "array", items: { type: "string" } } }, required: ["facts"], additionalProperties: false };
const chatBody = (response_format) => ({ messages: [{ role: "user", content: "hi" }], response_format });

describe("OpenAI Chat → Responses", () => {
  it("maps response_format json_schema to text.format", () => {
    const out = O2R(chatBody({ type: "json_schema", json_schema: { name: "Facts", strict: true, schema: SCHEMA } }));
    expect(out.text?.format).toEqual({ type: "json_schema", name: "Facts", schema: SCHEMA, strict: true });
  });

  it("maps response_format json_object to text.format", () => {
    const out = O2R(chatBody({ type: "json_object" }));
    expect(out.text?.format).toEqual({ type: "json_object" });
  });

  it("leaves text unset when no response_format is requested", () => {
    expect(O2R(chatBody(undefined)).text).toBeUndefined();
  });
});

describe("OpenAI Responses → Chat", () => {
  it("maps text.format back to response_format and drops the Responses-only field", () => {
    const out = R2O({
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      text: { format: { type: "json_schema", name: "Facts", strict: true, schema: SCHEMA } },
    });
    expect(out.response_format).toEqual({ type: "json_schema", json_schema: { name: "Facts", schema: SCHEMA, strict: true } });
    expect(out.text).toBeUndefined();
  });
});
