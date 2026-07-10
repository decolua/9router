import { describe, expect, it } from "vitest";
import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const SEP = "\n\n";

describe("injectSystemPrompt — OpenAI Responses format", () => {
  it("appends to body.instructions when present (no input mutation)", () => {
    const body = {
      instructions: "be brief",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
    };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "extra rule");

    expect(body.instructions).toBe(`be brief${SEP}extra rule`);
    expect(body.input).toHaveLength(1);
  });

  it("sets body.instructions when empty string", () => {
    const body = {
      instructions: "",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
    };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "extra rule");

    expect(body.instructions).toBe("extra rule");
    expect(body.input).toHaveLength(1);
  });

  it("unshifts proper Responses item when no instructions and no system/developer in input", () => {
    const body = {
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
    };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "be terse");

    expect(body.input).toHaveLength(2);
    expect(body.input[0]).toEqual({
      type: "message",
      role: "system",
      content: [{ type: "input_text", text: "be terse" }],
    });
  });

  it("appends to existing system message in input[] with typed array", () => {
    const body = {
      input: [
        { type: "message", role: "system", content: [{ type: "input_text", text: "base" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
    };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "extra");

    expect(body.input[0].content).toEqual([
      { type: "input_text", text: "base" },
      { type: "input_text", text: "extra" },
    ]);
  });

  it("converts bare-string system content to typed array on append", () => {
    const body = {
      input: [
        { type: "message", role: "system", content: "base" },
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
    };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "extra");

    expect(body.input[0].content).toEqual([
      { type: "input_text", text: `base${SEP}extra` },
    ]);
  });

  it("adds type:message when appending to system item that lacks type", () => {
    const body = {
      input: [
        { role: "system", content: "base" },
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
    };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "extra");

    expect(body.input[0].type).toBe("message");
  });

  it("double injection (caveman + ponytail) produces valid items", () => {
    const body = {
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
    };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "caveman prompt");
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "ponytail prompt");

    expect(body.input).toHaveLength(2);
    expect(body.input[0].type).toBe("message");
    expect(body.input[0].role).toBe("system");
    expect(body.input[0].content).toHaveLength(2);
    expect(body.input[0].content[0]).toEqual({ type: "input_text", text: "caveman prompt" });
    expect(body.input[0].content[1]).toEqual({ type: "input_text", text: "ponytail prompt" });
  });
});

describe("injectSystemPrompt — OpenAI Chat Completions format (unchanged behavior)", () => {
  it("unshifts {role,content:string} for Chat Completions", () => {
    const body = {
      messages: [{ role: "user", content: "hi" }],
    };
    injectSystemPrompt(body, FORMATS.OPENAI, "be terse");

    expect(body.messages[0]).toEqual({ role: "system", content: "be terse" });
  });

  it("appends string content for Chat Completions system message", () => {
    const body = {
      messages: [{ role: "system", content: "base" }],
    };
    injectSystemPrompt(body, FORMATS.OPENAI, "extra");

    expect(body.messages[0].content).toBe(`base${SEP}extra`);
    expect(body.messages[0].type).toBeUndefined();
  });
});
