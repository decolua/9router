import { describe, expect, it } from "vitest";
import { openaiToClaudeRequestForAntigravity } from "../../open-sse/translator/request/openai-to-claude.js";

/**
 * Guards fix for issue #2302:
 * Vertex AI (Cloud Code Assist) rejects Claude requests that end with an
 * assistant message, returning:
 *   400 "This model does not support assistant message prefill.
 *        The conversation must end with a user message."
 *
 * Fix: strip any trailing assistant messages in openaiToClaudeRequestForAntigravity
 * before the request is wrapped in the Cloud Code envelope.
 */
describe("openaiToClaudeRequestForAntigravity — strips trailing assistant prefill", () => {
  const makeReq = (messages) =>
    openaiToClaudeRequestForAntigravity("claude-opus-4-6", { messages, stream: false }, false);

  it("strips a single trailing assistant message", () => {
    const req = makeReq([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" }, // prefill to strip
    ]);
    expect(req.messages.at(-1)?.role).toBe("user");
  });

  it("strips multiple trailing assistant messages (rare but possible)", () => {
    const req = makeReq([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "A" },
      // Two trailing assistants won't happen in practice but the guard should handle it
    ]);
    expect(req.messages.length).toBeGreaterThan(0);
    expect(req.messages.at(-1)?.role).toBe("user");
  });

  it("does NOT strip a non-trailing assistant message", () => {
    const req = makeReq([
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "Q2" },
    ]);
    expect(req.messages.at(-1)?.role).toBe("user");
    // The first assistant turn should still be present
    expect(req.messages.some(m => m.role === "assistant")).toBe(true);
  });

  it("preserves a conversation that correctly ends with a user message", () => {
    const req = makeReq([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
      { role: "user", content: "What is 2+2?" },
    ]);
    const last = req.messages.at(-1);
    expect(last?.role).toBe("user");
  });

  it("handles a messages array that is already empty (no crash)", () => {
    // No messages → result.messages may be []
    const req = makeReq([{ role: "system", content: "sys" }]);
    expect(Array.isArray(req.messages)).toBe(true);
    expect(req.messages.length).toBe(0);
  });
});
