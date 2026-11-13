import { describe, it, expect } from "vitest";
import { extractMessages } from "../../src/app/(dashboard)/dashboard/usage/components/chatExtract.js";

// Anthropic /v1/messages carries the system prompt in a TOP-LEVEL `system`
// field (string or content-block array), not inside messages[] — the Original
// and Client views must surface it, not silently drop it.
describe("PromptChatView.extractMessages — system prompts", () => {
  it("prepends an anthropic string system prompt", () => {
    const msgs = extractMessages({
      system: "You are Claude Code",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    expect(msgs[0]).toEqual({ role: "system", content: "You are Claude Code" });
    expect(msgs).toHaveLength(2);
  });

  it("prepends an anthropic block-array system prompt", () => {
    const msgs = extractMessages({
      system: [
        { type: "text", text: "First block", cache_control: { type: "ephemeral" } },
        { type: "text", text: "Second block" },
      ],
      messages: [{ role: "user", content: "hi" }],
    });
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("First block");
    expect(msgs[0].content).toContain("Second block");
  });

  it("does not double-add when messages already start with a system role", () => {
    const msgs = extractMessages({
      system: "top-level",
      messages: [
        { role: "system", content: "in-messages" },
        { role: "user", content: "hi" },
      ],
    });
    expect(msgs.filter((m) => m.role === "system")).toHaveLength(2);
    expect(msgs[0].content).toBe("top-level");
  });

  it("surfaces Responses API instructions", () => {
    const msgs = extractMessages({
      instructions: "You are an assistant",
      input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
    });
    expect(msgs[0]).toEqual({ role: "system", content: "You are an assistant" });
  });

  it("surfaces Gemini systemInstruction parts", () => {
    const msgs = extractMessages({
      systemInstruction: { parts: [{ text: "Be helpful" }] },
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
    });
    expect(msgs[0]).toEqual({ role: "system", content: "Be helpful" });
    expect(msgs).toHaveLength(2);
  });

  it("leaves OpenAI-wire bodies unchanged (system already in messages)", () => {
    const body = {
      messages: [
        { role: "system", content: "already there" },
        { role: "user", content: "hi" },
      ],
    };
    expect(extractMessages(body)).toEqual(body.messages);
  });

  it("omits empty system fields", () => {
    expect(extractMessages({ system: "", messages: [{ role: "user", content: "hi" }] })).toHaveLength(1);
    expect(extractMessages({ messages: [{ role: "user", content: "hi" }] })).toHaveLength(1);
  });
});
