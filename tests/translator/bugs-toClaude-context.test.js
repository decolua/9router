// OpenAI-format CLI → Claude provider. Context pollution + lossy mapping on the openai→claude leg.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";

// anthropic-compatible provider so prepareClaudeRequest runs the openai→claude path
const T = (body) =>
  translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "m", body, true, null, "anthropic-compatible-x");

describe("OpenAI → Claude context mapping", () => {
  // openai-to-claude.js:124-134 — always injects CLAUDE_SYSTEM_PROMPT ("You are Claude Code")
  // KNOWN BUG: pollutes requests for non-official Claude-compatible providers
  it.fails("does not inject Claude Code system prompt for compatible providers", () => {
    const out = T({ messages: [{ role: "user", content: "hi" }] });
    expect(JSON.stringify(out.system), "Claude Code prompt injected").not.toContain("Claude Code");
  });

  it("assistant reasoning_content becomes a thinking block", () => {
    const out = T({
      messages: [
        { role: "user", content: "q" },
        { role: "assistant", content: "a", reasoning_content: "my hidden reasoning" },
        { role: "user", content: "next" },
      ],
    });
    expect(JSON.stringify(out), "reasoning_content lost").toContain("my hidden reasoning");
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content[0]).toEqual(expect.objectContaining({
      type: "thinking",
      thinking: "my hidden reasoning",
    }));
  });

  // openai-to-claude.js:298 — tool_choice "none" mapped to {type:"auto"} (loses "do not call" intent)
  // KNOWN BUG
  it.fails("tool_choice=none is not turned into auto", () => {
    const out = T({
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "f", parameters: { type: "object", properties: {} } } }],
      tool_choice: "none",
    });
    expect(out.tool_choice?.type, "none became auto → model may call tools").not.toBe("auto");
  });

  // getContentBlocksFromMessage — no input_audio branch → audio dropped
  // KNOWN BUG
  it.fails("input_audio content is preserved", () => {
    const out = T({
      messages: [{ role: "user", content: [
        { type: "text", text: "transcribe" },
        { type: "input_audio", input_audio: { data: "AUDIO_B64", format: "wav" } },
      ] }],
    });
    expect(JSON.stringify(out), "audio dropped").toContain("AUDIO_B64");
  });

  // openai-to-claude.js:235-251 — remote http image_url is kept (regression guard)
  it("remote http image_url is preserved", () => {
    const out = T({
      messages: [{ role: "user", content: [
        { type: "text", text: "see" },
        { type: "image_url", image_url: { url: "https://x.com/pic.png" } },
      ] }],
    });
    expect(JSON.stringify(out), "remote image dropped").toContain("pic.png");
  });

  it("DeepSeek Claude transport adds a thinking placeholder before tool_use in thinking mode", () => {
    const out = prepareClaudeRequest({
      model: "deepseek-v4-pro",
      thinking: { type: "enabled" },
      messages: [
        { role: "user", content: [{ type: "text", text: "q" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "x" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] },
        { role: "user", content: [{ type: "text", text: "continue" }] },
      ],
    }, "deepseek");

    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content[0]).toEqual({ type: "thinking", thinking: "." });
    expect(assistant.content[1]).toEqual(expect.objectContaining({ type: "tool_use", id: "toolu_1" }));
    expect(assistant.content[0].signature).toBeUndefined();
  });
});
