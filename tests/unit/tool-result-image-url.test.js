/**
 * Regression for #5125: an image_url part inside a role:"tool" message must be
 * converted to a Claude image block, not forwarded as an OpenAI part.
 */
import { describe, it, expect } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

function toolResultContent(body) {
  const toolMsg = body.messages.find(m => Array.isArray(m.content) && m.content.some(b => b.type === "tool_result"));
  return toolMsg.content.find(b => b.type === "tool_result").content;
}

describe("tool message with image_url part (#5125)", () => {
  it("converts image_url inside a tool result to a Claude image block", () => {
    const body = {
      model: "claude-haiku-4-5",
      messages: [
        { role: "user", content: "look at image" },
        { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "v", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "t1", content: [
          { type: "text", text: "shot" },
          { type: "image_url", image_url: { url: PNG } },
        ] },
      ],
    };

    const out = openaiToClaudeRequest("claude-haiku-4-5", body, false);
    const content = toolResultContent(out);

    expect(content.some(p => p.type === "image_url")).toBe(false);
    const img = content.find(p => p.type === "image");
    expect(img).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } });
    expect(content.find(p => p.type === "text").text).toBe("shot");
  });

  it("keeps a plain string tool result unchanged", () => {
    const body = {
      model: "claude-haiku-4-5",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: null, tool_calls: [{ id: "t2", type: "function", function: { name: "v", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "t2", content: "plain result" },
      ],
    };
    const out = openaiToClaudeRequest("claude-haiku-4-5", body, false);
    expect(toolResultContent(out)).toBe("plain result");
  });
});
