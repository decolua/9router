// Claude Code puts a `context_management` block (context-editing strategy: the
// `clear_tool_uses_*` / `clear_thinking_*` edit descriptors) in every request.
// The field is gated on the context-management beta AND only defined by
// Anthropic's Messages API. A Claude-format request to any other provider keeps
// the field — same-format claude→claude requests skip body rebuilding in the
// translator — and strict Claude-compatible gateways reject the whole request:
//   400 {"type":"error","error":{"type":"invalid_request_error",
//        "message":"Upstream request failed: [invalid_request_error]
//                   context_management: Extra inputs are not permitted"}}
// Anthropic itself (the `claude` provider and anthropic-compatible-* nodes) must
// keep receiving the block so context editing still works there.
import { describe, it, expect } from "vitest";
import { prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";

const body = () => ({
  model: "claude-haiku-5-5",
  max_tokens: 1024,
  context_management: {
    edits: [{ type: "clear_tool_uses_20250919", trigger: { type: "input_tokens", value: 100000 }, keep: { type: "tool_uses", value: 3 } }],
  },
  messages: [
    { role: "user", content: "hi" },
    { role: "assistant", content: [{ type: "text", text: "hello" }] },
    { role: "user", content: "continue" },
  ],
});

describe("prepareClaudeRequest — context_management field scoping", () => {
  it("strips context_management for a non-Anthropic provider (opencode-go)", () => {
    const out = prepareClaudeRequest(body(), "opencode-go");
    expect(out.context_management).toBeUndefined();
    expect(out.messages).toHaveLength(3);
  });

  it("strips context_management for other claude-transport engines (deepseek)", () => {
    const out = prepareClaudeRequest(body(), "deepseek");
    expect(out.context_management).toBeUndefined();
  });

  it("keeps context_management for the native claude provider", () => {
    const out = prepareClaudeRequest(body(), "claude");
    expect(out.context_management).toBeDefined();
  });

  it("keeps context_management for anthropic-compatible-* nodes fronting Anthropic", () => {
    const out = prepareClaudeRequest(body(), "anthropic-compatible-someproxy");
    expect(out.context_management).toBeDefined();
  });
});
