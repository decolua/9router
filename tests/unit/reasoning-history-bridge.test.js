/**
 * Unit tests for the reasoning/thinking bridge across the OpenAI intermediate
 * request-translation format.
 *
 * The OpenAI Chat Completions spec has no native thinking/reasoning field for
 * request *history* (only reasoning_content on assistant messages, which
 * upstream itself uses). Several source -> openai translators dropped
 * incoming thinking/thought content instead of mapping it to reasoning_content,
 * and several openai -> target translators dropped reasoning_content instead of
 * mapping it to the target's native thinking representation. Once dropped on
 * one hop, thinking content is gone for good on every subsequent hop (combo
 * switch, retry, translation) because nothing carries it forward.
 */

import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("reasoning/thinking bridge", () => {
  it("openai -> claude: reasoning_content becomes a leading thinking block", () => {
    const body = {
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1", reasoning_content: "r1" },
        { role: "user", content: "u2" },
      ],
    };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4.5", body, true, {}, "anthropic");
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content[0]).toEqual({ type: "thinking", thinking: "r1" });
    expect(assistant.content[1]).toMatchObject({ type: "text", text: "a1" });
  });

  it("openai -> claude: reasoning_content survives alongside tool_calls", () => {
    const body = {
      messages: [
        { role: "user", content: "u" },
        {
          role: "assistant",
          content: null,
          reasoning_content: "planning",
          tool_calls: [{ id: "c1", type: "function", function: { name: "Read", arguments: '{"path":"x"}' } }],
        },
      ],
    };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4.5", body, true, {}, "anthropic");
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content[0]).toMatchObject({ type: "thinking", thinking: "planning" });
    expect(assistant.content[1].type).toBe("tool_use");
  });

  it("openai -> claude: no reasoning_content means no thinking block (negative control)", () => {
    const body = { messages: [{ role: "user", content: "u" }, { role: "assistant", content: "a" }] };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4.5", body, true, {}, "anthropic");
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content.find((b) => b.type === "thinking")).toBeUndefined();
  });

  it("openai -> claude: an already-present thinking block is not duplicated", () => {
    const body = {
      messages: [
        { role: "user", content: "u" },
        { role: "assistant", content: [{ type: "thinking", thinking: "already" }, { type: "text", text: "a" }] },
      ],
    };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4.5", body, true, {}, "anthropic");
    const assistant = out.messages.find((m) => m.role === "assistant");
    const thinkingBlocks = assistant.content.filter((b) => b.type === "thinking");
    expect(thinkingBlocks).toHaveLength(1);
    expect(thinkingBlocks[0].thinking).toBe("already");
  });

  it("claude -> openai: a thinking block becomes reasoning_content", () => {
    const body = {
      system: "sys",
      max_tokens: 100,
      messages: [
        { role: "user", content: [{ type: "text", text: "u" }] },
        { role: "assistant", content: [{ type: "thinking", thinking: "my reasoning" }, { type: "text", text: "my answer" }] },
      ],
    };
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "m", body, true);
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.reasoning_content).toBe("my reasoning");
    expect(assistant.content).toBeTruthy();
  });

  it("claude -> openai -> claude roundtrip: thinking survives a full hop and back", () => {
    const body = {
      system: "sys",
      max_tokens: 100,
      messages: [
        { role: "user", content: [{ type: "text", text: "u" }] },
        { role: "assistant", content: [{ type: "thinking", thinking: "roundtrip reasoning" }, { type: "text", text: "roundtrip answer" }] },
      ],
    };
    const mid = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "m", body, true);
    const final = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4.5", mid, true, {}, "anthropic");
    const assistant = final.messages.find((m) => m.role === "assistant");
    const thinkingBlocks = assistant.content.filter((b) => b.type === "thinking");
    expect(thinkingBlocks).toHaveLength(1);
    expect(thinkingBlocks[0].thinking).toBe("roundtrip reasoning");
  });

  it("openai -> ollama: reasoning_content maps to message.thinking", () => {
    const body = { messages: [{ role: "user", content: "u" }, { role: "assistant", content: "a", reasoning_content: "ollama thinking" }] };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OLLAMA, "m", body, true);
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.thinking).toBe("ollama thinking");
  });

  it("openai -> commandcode: reasoning_content becomes a leading reasoning block", () => {
    const body = { messages: [{ role: "user", content: "u" }, { role: "assistant", content: "a", reasoning_content: "cc reasoning" }] };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.COMMANDCODE, "m", body, true);
    const assistant = out.params.messages.find((m) => m.role === "assistant");
    const reasoningBlock = assistant.content.find((b) => b.type === "reasoning");
    expect(reasoningBlock?.text).toBe("cc reasoning");
  });

  it("openai -> openai-responses: reasoning_content becomes a reasoning item", () => {
    const body = { messages: [{ role: "user", content: "u" }, { role: "assistant", content: "a", reasoning_content: "responses reasoning" }] };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "m", body, true);
    const reasoningItem = out.input.find((i) => i.type === "reasoning");
    expect(reasoningItem?.summary?.[0]?.text).toBe("responses reasoning");
  });

  it("gemini -> openai: a thought:true part maps to reasoning_content", () => {
    const body = {
      contents: [
        { role: "user", parts: [{ text: "u" }] },
        { role: "model", parts: [{ thought: true, text: "gemini thinking" }, { text: "gemini answer" }] },
      ],
    };
    const out = translateRequest(FORMATS.GEMINI, FORMATS.OPENAI, "m", body, true);
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.reasoning_content).toBe("gemini thinking");
  });
});
