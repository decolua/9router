import { describe, expect, it } from "vitest";

import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const PROMPT = "speak like a caveman";

// A Responses input[] message item may leave `type` off — the field defaults to
// "message". The repo already reads it that way in three other places:
//   open-sse/executors/codex.js:53      item.role === "system" && (!item.type || item.type === "message")
//   open-sse/executors/grok-cli.js:79   item.role === "user"   && (!type || type === "message")
//   open-sse/rtk/headroom.js:96         typeof item.type === "string" && item.type !== "message"
// and tests/unit/continuity-strip.test.js builds its fixture without the field.
describe("system injection into a Responses input[] whose items omit type", () => {
  it("appends to an untyped system item instead of prepending a second one", () => {
    const body = {
      input: [
        { role: "system", content: [{ type: "input_text", text: "you are a helper" }] },
        { role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
    };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, PROMPT);

    expect(body.input).toHaveLength(2);
    expect(body.input[0].content).toEqual([
      { type: "input_text", text: "you are a helper" },
      { type: "input_text", text: PROMPT },
    ]);
    expect(body.input.filter(i => i.role === "system")).toHaveLength(1);
  });

  it("treats an untyped developer item as the system channel too", () => {
    const body = { input: [{ role: "developer", content: "rules" }] };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, PROMPT);

    expect(body.input).toHaveLength(1);
    expect(body.input[0].content).toBe(`rules

${PROMPT}`);
  });

  it("stays idempotent when the prompt already sits in an untyped item", () => {
    const body = {
      input: [{ role: "system", content: [{ type: "input_text", text: PROMPT }] }],
    };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, PROMPT);
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, PROMPT);

    expect(body.input).toHaveLength(1);
    expect(body.input[0].content).toEqual([{ type: "input_text", text: PROMPT }]);
  });

  it("still skips a non-message item that carries a role-like field", () => {
    const body = {
      input: [
        { type: "function_call", call_id: "c1", name: "sh", arguments: "{}", role: "system" },
        { type: "message", role: "system", content: [{ type: "input_text", text: "real" }] },
      ],
    };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, PROMPT);

    expect(body.input[0].type).toBe("function_call");
    expect(body.input[0].content).toBeUndefined();
    expect(body.input[1].content).toEqual([
      { type: "input_text", text: "real" },
      { type: "input_text", text: PROMPT },
    ]);
  });

  // appendToResponsesMessage dedups on its own, so the scan below only decides the
  // case where the prompt sits in a *different* system item than the one findIndex
  // returns. Without the untyped item being scanned, the prompt lands twice.
  it("does not duplicate a prompt already held by a later untyped system item", () => {
    const body = {
      input: [
        { type: "message", role: "system", content: [{ type: "input_text", text: "house rules" }] },
        { role: "system", content: [{ type: "input_text", text: PROMPT }] },
      ],
    };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, PROMPT);

    const occurrences = JSON.stringify(body.input).split(PROMPT).length - 1;
    expect(occurrences).toBe(1);
    expect(body.input[0].content).toEqual([{ type: "input_text", text: "house rules" }]);
  });

  it("keeps prepending when the input carries no system item at all", () => {
    const body = { input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }] };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, PROMPT);

    expect(body.input).toHaveLength(2);
    expect(body.input[0]).toEqual({
      type: "message",
      role: "system",
      content: [{ type: "input_text", text: PROMPT }],
    });
  });
});
