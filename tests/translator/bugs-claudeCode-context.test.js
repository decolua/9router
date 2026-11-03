// Real Claude Code CLI requests (Claude format) → non-Claude provider via OpenAI bridge.
// Focuses on context components a real CLI sends: system arrays w/ cache_control, thinking
// signatures, tool_result with images, audio. KNOWN BUG = it.fails (source file:line in comments).
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const T = (src, tgt, body, provider = null) =>
  translateRequest(src, tgt, "m", body, true, null, provider);

describe("Claude Code CLI context → OpenAI", () => {
  // claude-to-openai.js:24-27 — system array only maps .text; cache_control/non-text dropped
  it("system array keeps all text parts", () => {
    const out = T(FORMATS.CLAUDE, FORMATS.OPENAI, {
      system: [
        { type: "text", text: "You are Claude Code.", cache_control: { type: "ephemeral" } },
        { type: "text", text: "Follow repo conventions." },
      ],
      messages: [{ role: "user", content: "hi" }],
    });
    const sys = out.messages.find((m) => m.role === "system");
    expect(sys?.content).toContain("Claude Code");
    expect(sys?.content).toContain("repo conventions");
  });

  // claude→claude is passthrough (same format) → thinking preserved. Guards against
  // accidental routing through the OpenAI bridge for same-format requests.
  it("assistant thinking block survives Claude→Claude passthrough", () => {
    const out = T(FORMATS.CLAUDE, FORMATS.CLAUDE, {
      messages: [
        { role: "assistant", content: [
          { type: "thinking", thinking: "step-by-step plan", signature: "abc123" },
          { type: "text", text: "done" },
        ] },
        { role: "user", content: "next" },
      ],
    });
    expect(JSON.stringify(out)).toContain("step-by-step plan");
  });

  // claude-to-openai.js:128 — redacted_thinking also dropped
  // KNOWN BUG
  it.fails("redacted_thinking block is not silently dropped", () => {
    const out = T(FORMATS.CLAUDE, FORMATS.OPENAI, {
      messages: [
        { role: "assistant", content: [
          { type: "redacted_thinking", data: "ENCRYPTED_BLOB" },
          { type: "text", text: "answer" },
        ] },
        { role: "user", content: "go" },
      ],
    });
    expect(JSON.stringify(out)).toContain("ENCRYPTED_BLOB");
  });

  it("relocates tool_result images into the linked following user message", () => {
    const out = T(FORMATS.CLAUDE, FORMATS.OPENAI, {
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "screenshot", input: {} }] },
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "call_1", content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: "IMG" } },
          ] },
        ] },
      ],
    });
    const toolIndex = out.messages.findIndex((message) => message.role === "tool");
    expect(toolIndex).toBeGreaterThanOrEqual(0);
    expect(out.messages[toolIndex]).toEqual({ role: "tool", tool_call_id: "call_1", content: "" });
    expect(out.messages[toolIndex + 1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "[Image from tool result call_1]" },
        { type: "image_url", image_url: { url: "data:image/png;base64,IMG" } },
      ],
    });
  });
});
