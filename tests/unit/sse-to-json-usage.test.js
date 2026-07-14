import { describe, expect, it } from "vitest";
import { parseSSEToOpenAIResponse } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";

describe("parseSSEToOpenAIResponse usage", () => {
  it("keeps Kiro credit-only usage internal while hiding private fields from clients", () => {
    const raw = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"OK"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"m","choices":[],"usage":{"kiro_credits":0.0123,"kiro_credit_unit":"credit"}}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      "data: [DONE]",
    ].join("\n\n");

    const parsed = parseSSEToOpenAIResponse(raw, "m");

    expect(parsed.choices[0].message.content).toBe("OK");
    expect(parsed.usage).toEqual({});
    expect(parsed._internalUsage).toEqual({
      kiro_credits: 0.0123,
      kiro_credit_unit: "credit",
    });
    expect(JSON.stringify(parsed)).not.toContain("kiro_credits");
  });
});
