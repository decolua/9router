import { describe, expect, it } from "vitest";

const { injectSystemPrompt } = await import("../../open-sse/rtk/systemInject.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");

const PROMPT = "speak like a caveman";

describe("#3202 system injection uses the content-part type of the target API", () => {
  it("appends {type:'text'} to an array-content system message in messages[]", () => {
    const body = {
      messages: [
        { role: "system", content: [{ type: "text", text: "you are a helper" }] },
        { role: "user", content: [{ type: "text", text: "hi" }] },
      ],
    };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT);

    expect(body.messages[0].content).toEqual([
      { type: "text", text: "you are a helper" },
      { type: "text", text: PROMPT },
    ]);
    expect(JSON.stringify(body)).not.toContain("input_text");
  });

  it("appends {type:'input_text'} to an array-content system item in input[]", () => {
    const body = {
      input: [
        { role: "system", content: [{ type: "input_text", text: "you are a helper" }] },
        { role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
    };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, PROMPT);

    expect(body.input[0].content).toEqual([
      { type: "input_text", text: "you are a helper" },
      { type: "input_text", text: PROMPT },
    ]);
  });

  it("uses the chat part type for a developer message too", () => {
    const body = {
      messages: [{ role: "developer", content: [{ type: "text", text: "rules" }] }],
    };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT);

    expect(body.messages[0].content[1]).toEqual({ type: "text", text: PROMPT });
  });

  it("still concatenates plain-string system content", () => {
    const body = { messages: [{ role: "system", content: "you are a helper" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT);

    expect(body.messages[0].content).toBe(`you are a helper\n\n${PROMPT}`);
  });

  it("still prepends a system message when none exists", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT);

    expect(body.messages[0]).toEqual({ role: "system", content: PROMPT });
  });

  it("prepends a typed message item when input[] has no system item", () => {
    const body = { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }] };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, PROMPT);

    expect(body.input[0]).toEqual({
      type: "message",
      role: "system",
      content: [{ type: "input_text", text: PROMPT }],
    });
    expect(body.input[1].role).toBe("user");
  });

  // detectFormatByEndpoint deliberately labels /v1/chat/completions + input[] as
  // FORMATS.OPENAI because Cursor CLI posts a Responses body to the chat endpoint.
  // The part type therefore has to follow the body shape, not the format label.
  it("uses Responses part types for a Cursor-CLI body labelled FORMATS.OPENAI", () => {
    const body = { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }] };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT);

    expect(body.input[0]).toEqual({
      type: "message",
      role: "system",
      content: [{ type: "input_text", text: PROMPT }],
    });
    expect(JSON.stringify(body)).not.toContain('"type":"text"');
  });

  it("creates instructions when the Responses body carries a bare string input", () => {
    const body = { model: "gpt-5.6-sol", input: "hello", stream: false };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, PROMPT);

    expect(body.instructions).toBe(PROMPT);
    expect(body.input).toBe("hello");
  });

  it("leaves a chat body without messages[] untouched", () => {
    const body = { model: "gpt-4o-mini" };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT);

    expect(body).toEqual({ model: "gpt-4o-mini" });
  });

  it("does not leave blank lines in front of an empty system message", () => {
    const body = { messages: [{ role: "system", content: "" }, { role: "user", content: "hi" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT);

    expect(body.messages[0].content).toBe(PROMPT);
  });

  it("appends to top-level instructions when present", () => {
    const body = { instructions: "you are a helper", input: [] };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, PROMPT);

    expect(body.instructions).toBe(`you are a helper\n\n${PROMPT}`);
  });
});
