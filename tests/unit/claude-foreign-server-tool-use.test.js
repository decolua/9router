// A combo that mixes providers leaks foreign block shapes into the Claude history.
// Anthropic validates server_tool_use ids against ^srvtoolu_[a-zA-Z0-9_]+$ and 400s
// the whole request when a provider (e.g. z.ai/glm) emits OpenAI-style call_ ids.
import { describe, it, expect } from "vitest";
import { normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";

const glmServerToolUse = () => ({
  role: "assistant",
  content: [
    { type: "text", text: "searching" },
    { type: "server_tool_use", id: "call_50b82aba1b754d82a4408a53", name: "analyze_image", input: {} },
  ],
});

describe("normalizeClaudePassthrough — foreign server_tool_use ids", () => {
  it("drops a server_tool_use block whose id is not an srvtoolu_ id", () => {
    const out = normalizeClaudePassthrough({ messages: [glmServerToolUse()] });
    expect(out.messages[0].content).toEqual([{ type: "text", text: "searching" }]);
  });

  it("drops the paired tool_result so no orphan reference is left behind", () => {
    const out = normalizeClaudePassthrough({
      messages: [
        glmServerToolUse(),
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call_50b82aba1b754d82a4408a53", content: "boom" },
            { type: "text", text: "keep me" },
          ],
        },
      ],
    });
    expect(out.messages[1].content).toEqual([{ type: "text", text: "keep me" }]);
  });

  it("keeps a well-formed Anthropic server_tool_use block", () => {
    const block = { type: "server_tool_use", id: "srvtoolu_01EUi6RNgHntbStfCjgLyLzz", name: "web_search", input: {} };
    const out = normalizeClaudePassthrough({ messages: [{ role: "assistant", content: [block] }] });
    expect(out.messages[0].content).toEqual([block]);
  });

  it("keeps regular tool_use blocks, whatever their id looks like", () => {
    const block = { type: "tool_use", id: "call_942248714fef4a9abb8e8eff", name: "Bash", input: { command: "ls" } };
    const out = normalizeClaudePassthrough({ messages: [{ role: "assistant", content: [block] }] });
    expect(out.messages[0].content).toEqual([block]);
  });

  it("leaves a message with only a dropped block with an empty text block, not an empty content array", () => {
    const out = normalizeClaudePassthrough({
      messages: [{ role: "assistant", content: [{ type: "server_tool_use", id: "call_x", name: "analyze_image", input: {} }] }],
    });
    expect(out.messages[0].content).toEqual([{ type: "text", text: "" }]);
  });
});
