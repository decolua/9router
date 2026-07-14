import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

// Grounded in https://docs.x.ai/developers/tools/function-calling and
// https://docs.x.ai/developers/model-capabilities/text/structured-outputs
//
// xAI uses the OpenAI-compatible request shape, so 9router routes it through
// DefaultExecutor("xai") as a passthrough. These tests guard that:
//   - native json_schema is NOT downgraded to json_object (xAI supports it natively)
//   - json_object passes through
//   - tools / tool_choice pass through unchanged (strict is implicit on xAI)
//   - the json_schema -> json_object fallback still applies to openai-compatible-* providers

describe("xAI structured outputs passthrough", () => {
  it("preserves native response_format.json_schema (no downgrade to json_object)", () => {
    const exec = new DefaultExecutor("xai");
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: { vendor_name: { type: "string" }, total_amount: { type: "number" } },
      required: ["vendor_name", "total_amount"],
    };
    const body = {
      model: "grok-4.3",
      messages: [{ role: "user", content: "parse this invoice" }],
      response_format: { type: "json_schema", json_schema: { name: "invoice", schema } },
    };

    const out = exec.transformRequest("grok-4.3", body);

    expect(out.response_format.type).toBe("json_schema");
    expect(out.response_format.json_schema.schema).toEqual(schema);
    // ensure no injected system prompt fallback was added
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0].role).toBe("user");
  });

  it("passes response_format.json_object through unchanged", () => {
    const exec = new DefaultExecutor("xai");
    const body = {
      model: "grok-4.3",
      messages: [{ role: "user", content: "give me json" }],
      response_format: { type: "json_object" },
    };

    const out = exec.transformRequest("grok-4.3", body);

    expect(out.response_format).toEqual({ type: "json_object" });
  });
});

describe("xAI function calling passthrough", () => {
  const tools = [
    {
      type: "function",
      function: {
        name: "get_temperature",
        description: "Get current temperature for a location",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            location: { type: "string", description: "City name" },
            unit: { type: "string", enum: ["celsius", "fahrenheit"] },
          },
          required: ["location"],
        },
      },
    },
  ];

  it("preserves tools array unchanged (strict stays implicit on xAI)", () => {
    const exec = new DefaultExecutor("xai");
    const body = {
      model: "grok-4.3",
      messages: [{ role: "user", content: "temp in SF?" }],
      tools,
    };

    const out = exec.transformRequest("grok-4.3", body);

    expect(out.tools).toEqual(tools);
    // we intentionally do NOT inject strict:true — xAI applies strict implicitly
    expect(out.tools[0].function.strict).toBeUndefined();
  });

  it("preserves tool_choice unchanged", () => {
    const exec = new DefaultExecutor("xai");
    const body = {
      model: "grok-4.3",
      messages: [{ role: "user", content: "temp in SF?" }],
      tools,
      tool_choice: { type: "function", function: { name: "get_temperature" } },
    };

    const out = exec.transformRequest("grok-4.3", body);

    expect(out.tool_choice).toEqual({ type: "function", function: { name: "get_temperature" } });
  });
});

describe("json_schema fallback still applies to openai-compatible providers", () => {
  it("downgrades json_schema to json_object and injects schema prompt for openai-compatible-*", () => {
    const exec = new DefaultExecutor("openai-compatible-someproxy");
    const schema = { type: "object", properties: { x: { type: "string" } }, required: ["x"] };
    const body = {
      model: "some-model",
      messages: [{ role: "user", content: "hi" }],
      response_format: { type: "json_schema", json_schema: { name: "s", schema } },
    };

    const out = exec.transformRequest("some-model", body);

    expect(out.response_format).toEqual({ type: "json_object" });
    // a system prompt carrying the schema is injected
    const sys = out.messages.find((m) => m.role === "system");
    expect(sys).toBeTruthy();
    expect(typeof sys.content === "string" ? sys.content : JSON.stringify(sys.content)).toContain("JSON schema");
  });
});
