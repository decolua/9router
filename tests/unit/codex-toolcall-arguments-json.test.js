/**
 * Regression: Codex replays raw streamed args verbatim. A partial-fragment or
 * freeform-text string lands in `function.arguments` and upstream rejects the
 * chat/completions body with HTTP 400 "function.arguments must be valid JSON".
 * Guard lives in two places:
 *   1. `ensureToolCallIds` (toolCall.js) — global, covers any chat-shaped body.
 *   2. Responses→Chat translator (openai-responses.js) — catches the Codex
 *      Responses-path leak at translation time before ensureToolCallIds.
 */
import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { ensureToolCallIds } from "../../open-sse/translator/concerns/toolCall.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// ---------- toolCall.js ensureToolCallIds ----------
describe("ensureToolCallIds: arguments JSON coercion", () => {
  const makeBody = (args) => ({
    messages: [
      {
        role: "assistant",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "fn", arguments: args } },
        ],
      },
    ],
  });

  it("valid JSON string passes through unchanged", () => {
    const body = makeBody('{"key":"val"}');
    ensureToolCallIds(body);
    expect(body.messages[0].tool_calls[0].function.arguments).toBe('{"key":"val"}');
  });

  it("malformed JSON string coerced to {}", () => {
    const body = makeBody('{"city":');
    ensureToolCallIds(body);
    expect(body.messages[0].tool_calls[0].function.arguments).toBe("{}");
  });

  it("freeform text coerced to {}", () => {
    const body = makeBody("San Francisco");
    ensureToolCallIds(body);
    expect(body.messages[0].tool_calls[0].function.arguments).toBe("{}");
  });

  it("object coerced to stringified JSON", () => {
    const body = makeBody({ city: "SF" });
    ensureToolCallIds(body);
    expect(body.messages[0].tool_calls[0].function.arguments).toBe('{"city":"SF"}');
  });

  it("null/undefined arguments left absent (no-op)", () => {
    const body = { messages: [{ role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "fn" } }] }] };
    ensureToolCallIds(body);
    expect(body.messages[0].tool_calls[0].function.arguments).toBeUndefined();
  });
});

// ---------- Responses→Chat translator ----------
describe("Responses→Chat: malformed arguments coerced at translation", () => {
  const inputWithArgs = (args) => ({
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      { type: "function_call", call_id: "call_abc", name: "get_weather", arguments: args },
    ],
  });

  it("valid JSON string preserved", () => {
    const result = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "gpt-4o", inputWithArgs('{"city":"NYC"}'));
    const assistant = result.messages.find((m) => m.tool_calls);
    expect(assistant.tool_calls[0].function.arguments).toBe('{"city":"NYC"}');
  });

  it("malformed string coerced to {}", () => {
    const result = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "gpt-4o", inputWithArgs('{"city":'));
    const assistant = result.messages.find((m) => m.tool_calls);
    expect(assistant.tool_calls[0].function.arguments).toBe("{}");
  });

  it("object coerced to stringified JSON", () => {
    const result = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "gpt-4o", inputWithArgs({ city: "SF" }));
    const assistant = result.messages.find((m) => m.tool_calls);
    expect(assistant.tool_calls[0].function.arguments).toBe('{"city":"SF"}');
  });
});
