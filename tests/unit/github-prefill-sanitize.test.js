/**
 * Regression test: GitHub Copilot's /chat/completions rejects a conversation that
 * ends with an assistant message ("This model does not support assistant message
 * prefill. The conversation must end with a user message.").
 *
 * Anthropic clients (e.g. newest Claude Desktop) send a trailing assistant turn as a
 * prefill seed. The Anthropic API honors it but Copilot 400s, so the GitHub executor
 * must drop trailing assistant message(s) before dispatching to /chat/completions.
 */

import { describe, it, expect } from "vitest";
import { GithubExecutor } from "../../open-sse/executors/github.js";

describe("GithubExecutor prefill sanitization", () => {
  const exec = new GithubExecutor();

  it("drops a trailing assistant prefill message", () => {
    const body = {
      model: "claude-sonnet-4.6",
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Here is the answer:" },
      ],
    };
    const out = exec.sanitizeMessagesForChatCompletions(body);
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0].role).toBe("user");
  });

  it("drops multiple consecutive trailing assistant messages", () => {
    const out = exec.dropTrailingAssistantPrefill([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "one" },
      { role: "assistant", content: "two" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("user");
  });

  it("leaves a conversation ending in a user message untouched", () => {
    const messages = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
      { role: "user", content: "More" },
    ];
    const out = exec.dropTrailingAssistantPrefill(messages);
    expect(out).toBe(messages); // same reference — no-op
    expect(out).toHaveLength(3);
  });

  it("leaves a conversation ending in a tool message untouched", () => {
    const messages = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: null, tool_calls: [{ id: "x" }] },
      { role: "tool", tool_call_id: "x", content: "result" },
    ];
    const out = exec.dropTrailingAssistantPrefill(messages);
    expect(out).toHaveLength(3);
    expect(out[2].role).toBe("tool");
  });

  it("never empties an assistant-only conversation (keeps at least one message)", () => {
    const out = exec.dropTrailingAssistantPrefill([
      { role: "assistant", content: "only" },
    ]);
    expect(out).toHaveLength(1);
  });

  it("is null/empty safe", () => {
    expect(exec.dropTrailingAssistantPrefill([])).toEqual([]);
    expect(exec.dropTrailingAssistantPrefill(undefined)).toBeUndefined();
  });
});
