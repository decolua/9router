import { describe, it, expect } from "vitest";
import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("systemInject — array-content system message (chat)", () => {
  it("injects a {type:\"text\"} part when chat system content is an array", () => {
    const body = {
      messages: [
        { role: "system", content: [{ type: "text", text: "You are a helper." }] },
        { role: "user", content: "hi" },
      ],
    };
    injectSystemPrompt(body, FORMATS.OPENAI, "caveman prompt");
    const sys = body.messages[0];
    expect(sys.content.length).toBe(2);
    expect(sys.content[1]).toEqual({ type: "text", text: "caveman prompt" });
    expect(sys.content.some(p => p.type === "input_text")).toBe(false);
  });

  it("appends to string content without changing its type", () => {
    const body = {
      messages: [
        { role: "system", content: "You are a helper." },
        { role: "user", content: "hi" },
      ],
    };
    injectSystemPrompt(body, FORMATS.OPENAI, "caveman prompt");
    expect(body.messages[0].content).toBe("You are a helper.\n\ncaveman prompt");
  });

  it("unshifts a plain system message when chat has no system/developer", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, "caveman prompt");
    expect(body.messages[0]).toEqual({ role: "system", content: "caveman prompt" });
    expect(body.messages[1]).toEqual({ role: "user", content: "hi" });
  });
});

describe("systemInject — responses input[]", () => {
  it("keeps {type:\"input_text\"} parts when responses input content is an array", () => {
    const body = {
      input: [
        { type: "message", role: "system", content: [{ type: "input_text", text: "You are a helper." }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
    };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "caveman prompt");
    const sys = body.input[0];
    expect(sys.content.length).toBe(2);
    expect(sys.content[1]).toEqual({ type: "input_text", text: "caveman prompt" });
  });

  it("unshifts a typed message item when responses input has no system/developer", () => {
    const body = {
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
    };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "caveman prompt");
    expect(body.input[0]).toEqual({
      type: "message",
      role: "system",
      content: [{ type: "input_text", text: "caveman prompt" }],
    });
  });

  it("appends to top-level instructions when present", () => {
    const body = { instructions: "You are a helper.", input: [] };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "caveman prompt");
    expect(body.instructions).toBe("You are a helper.\n\ncaveman prompt");
  });

  it("sets top-level instructions when absent", () => {
    const body = { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }] };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "caveman prompt");
    expect(body.instructions).toBe("caveman prompt");
  });
});
