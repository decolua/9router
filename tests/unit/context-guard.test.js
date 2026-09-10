import { describe, expect, it, vi } from "vitest";
import {
  guardRequestForModelContext,
  stripHistoryForContext,
} from "../../open-sse/services/capacityAdapter.js";

function bigText(chars) {
  return "x".repeat(chars);
}

describe("context guard", () => {
  it("is a no-op for a small request (object identity preserved)", () => {
    const body = {
      messages: [
        { role: "system", content: "be helpful" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "how are you" },
      ],
    };
    expect(guardRequestForModelContext(body, "kiro/claude-opus-4.8")).toBe(body);
  });

  it("leaves models with no declared context untouched", () => {
    const body = {
      messages: Array.from({ length: 40 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: bigText(20000),
      })),
    };
    // Unknown provider/model → no declared context window → no strip.
    expect(guardRequestForModelContext(body, "totally-unknown/mystery-model")).toBe(body);
  });

  it("drops the middle but keeps system and current turn when over budget", () => {
    const onStrip = vi.fn();
    const messages = [
      { role: "system", content: "SYSTEM RULES" },
      ...Array.from({ length: 30 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: bigText(40000),
      })),
      { role: "user", content: "CURRENT QUESTION" },
    ];
    const result = stripHistoryForContext({ messages }, 200000, onStrip);

    expect(result.messages).not.toBe(messages);
    expect(result.messages[0]).toEqual({ role: "system", content: "SYSTEM RULES" });
    expect(result.messages.at(-1)).toEqual({ role: "user", content: "CURRENT QUESTION" });
    expect(result.messages.length).toBeLessThan(messages.length);
    expect(onStrip).toHaveBeenCalledWith(expect.objectContaining({
      key: "messages",
      droppedMessages: expect.any(Number),
    }));
  });

  it("keeps the assistant tool_use bridge when the current run is a tool_result", () => {
    const messages = [
      { role: "system", content: "SYSTEM" },
      ...Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: bigText(40000),
      })),
      { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "read", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "file body" }] },
    ];
    const result = stripHistoryForContext({ messages }, 200000);

    const last = result.messages.at(-1);
    const bridge = result.messages.at(-2);
    expect(last.content[0].tool_use_id).toBe("call_1");
    expect(bridge.content[0]).toMatchObject({ type: "tool_use", id: "call_1" });
    expect(result.messages.length).toBeLessThan(messages.length);
  });

  it("fails open when a tool_result has no matching preceding tool_use", () => {
    const messages = [
      { role: "system", content: "SYSTEM" },
      ...Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: bigText(40000),
      })),
      { role: "assistant", content: [{ type: "tool_use", id: "call_A", name: "read", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_MISSING", content: "x" }] },
    ];
    // Bridge cannot satisfy the orphan tool_result → return body unchanged.
    expect(stripHistoryForContext({ messages }, 200000)).toEqual({ messages });
  });

  it("counts structured tool blocks by serialized size", () => {
    const heavyToolResult = {
      messages: [
        { role: "user", content: "start" },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: "read", input: { path: bigText(60000) } }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: bigText(900000) }],
        },
        { role: "assistant", content: "ok" },
        { role: "user", content: "final" },
      ],
    };
    // 900k-char tool_result far exceeds the 200k*0.8*4 budget → must strip.
    const result = stripHistoryForContext(heavyToolResult, 200000);
    expect(result.messages.at(-1)).toEqual({ role: "user", content: "final" });
  });
});
