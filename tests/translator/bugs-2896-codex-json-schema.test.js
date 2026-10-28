// Issue #2896: a Chat Completions request with response_format reached the
// Codex Responses API without it. The OpenAI → Responses translator did not
// map it, and the Codex executor's allowlist strips response_format, so the
// model answered in free text instead of the requested JSON.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const toResponses = (body) =>
  translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "m", body, false, null, null);

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["guests"],
  properties: { guests: { type: "integer" } },
};

describe("bug #2896: Chat Completions response_format → Responses text.format", () => {
  it("json_schema becomes text.format with its name, strict flag and schema", () => {
    const out = toResponses({
      messages: [{ role: "user", content: "2 people" }],
      response_format: { type: "json_schema", json_schema: { name: "reading", strict: true, schema } },
    });
    expect(out.text).toEqual({ format: { type: "json_schema", name: "reading", strict: true, schema } });
  });

  it("json_schema without strict is strict, as Chat Completions treats it on Codex", () => {
    const out = toResponses({
      messages: [{ role: "user", content: "2 people" }],
      response_format: { type: "json_schema", json_schema: { name: "reading", schema } },
    });
    expect(out.text.format.strict).toBe(true);
  });

  it("json_object stays json_object", () => {
    const out = toResponses({
      messages: [{ role: "user", content: "2 people" }],
      response_format: { type: "json_object" },
    });
    expect(out.text).toEqual({ format: { type: "json_object" } });
  });

  it("no response_format adds no text field", () => {
    const out = toResponses({ messages: [{ role: "user", content: "hi" }] });
    expect(out.text).toBeUndefined();
  });
});
