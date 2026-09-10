import assert from "node:assert/strict";
import "../../tests/translator/registerAll.js";
import { translateRequest } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { DEFAULT_THINKING_CLAUDE_SIGNATURE } from "../config/defaultThinkingSignature.js";

// 1. OpenAI → Claude: reasoning_content becomes a thinking block
{
  const body = {
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1", reasoning_content: "r1" },
      { role: "user", content: "u2" }
    ]
  };
  const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4.5", body, true, {}, "anthropic");
  const assistant = out.messages.find(m => m.role === "assistant");
  assert.equal(assistant.content[0].type, "thinking", "thinking block comes first");
  assert.equal(assistant.content[0].thinking, "r1");
  assert.equal(assistant.content[1].type, "text");
  assert.equal(assistant.content[1].text, "a1");
}

// 2. OpenAI → Claude: reasoning_content with tool_calls
{
  const body = {
    messages: [
      { role: "user", content: "u" },
      {
        role: "assistant",
        content: null,
        reasoning_content: "planning",
        tool_calls: [{ id: "c1", type: "function", function: { name: "Read", arguments: '{"path":"x"}' } }]
      }
    ]
  };
  const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4.5", body, true, {}, "anthropic");
  const assistant = out.messages.find(m => m.role === "assistant");
  assert.equal(assistant.content[0].type, "thinking");
  assert.equal(assistant.content[0].thinking, "planning");
  assert.equal(assistant.content[1].type, "tool_use");
}

// 3. OpenAI → Claude: no reasoning_content → no thinking block
{
  const body = { messages: [{ role: "user", content: "u" }, { role: "assistant", content: "a" }] };
  const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4.5", body, true, {}, "anthropic");
  const assistant = out.messages.find(m => m.role === "assistant");
  assert.equal(assistant.content.find(b => b.type === "thinking"), undefined);
}

// 4. OpenAI → Claude: existing thinking block not duplicated
{
  const body = {
    messages: [
      { role: "user", content: "u" },
      { role: "assistant", content: [{ type: "thinking", thinking: "already" }, { type: "text", text: "a" }] }
    ]
  };
  const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4.5", body, true, {}, "anthropic");
  const assistant = out.messages.find(m => m.role === "assistant");
  const thinkingBlocks = assistant.content.filter(b => b.type === "thinking");
  assert.equal(thinkingBlocks.length, 1, "no duplicate thinking block from reasoning_content");
  assert.equal(thinkingBlocks[0].thinking, "already");
}

// 5. Claude → OpenAI: thinking block becomes reasoning_content
{
  const body = {
    system: "sys",
    max_tokens: 100,
    messages: [
      { role: "user", content: [{ type: "text", text: "u" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "my reasoning" }, { type: "text", text: "my answer" }] }
    ]
  };
  const out = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "m", body, true);
  const assistant = out.messages.find(m => m.role === "assistant");
  assert.equal(assistant.reasoning_content, "my reasoning", "thinking → reasoning_content");
  const textPart = assistant.content;
  assert.ok(textPart, "content preserved");
}

// 6. Claude → OpenAI → Claude roundtrip: thinking survives
{
  const body = {
    system: "sys",
    max_tokens: 100,
    messages: [
      { role: "user", content: [{ type: "text", text: "u" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "roundtrip reasoning" }, { type: "text", text: "roundtrip answer" }] }
    ]
  };
  const mid = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "m", body, true);
  const final = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4.5", mid, true, {}, "anthropic");
  const assistant = final.messages.find(m => m.role === "assistant");
  const thinkingBlocks = assistant.content.filter(b => b.type === "thinking");
  assert.equal(thinkingBlocks.length, 1, "roundtrip: one thinking block");
  assert.equal(thinkingBlocks[0].thinking, "roundtrip reasoning", "roundtrip: reasoning preserved");
}

// 7. OpenAI → Ollama: reasoning_content → message.thinking
{
  const body = { messages: [{ role: "user", content: "u" }, { role: "assistant", content: "a", reasoning_content: "ollama thinking" }] };
  const out = translateRequest(FORMATS.OPENAI, FORMATS.OLLAMA, "m", body, true);
  const assistant = out.messages.find(m => m.role === "assistant");
  assert.equal(assistant.thinking, "ollama thinking", "reasoning_content → thinking for ollama");
}

// 8. OpenAI → CommandCode: reasoning_content → reasoning block
{
  const body = { messages: [{ role: "user", content: "u" }, { role: "assistant", content: "a", reasoning_content: "cc reasoning" }] };
  const out = translateRequest(FORMATS.OPENAI, FORMATS.COMMANDCODE, "m", body, true);
  const assistant = out.params.messages.find(m => m.role === "assistant");
  const reasoningBlock = assistant.content.find(b => b.type === "reasoning");
  assert.ok(reasoningBlock, "reasoning block present in commandcode output");
  assert.equal(reasoningBlock.text, "cc reasoning", "reasoning_content → reasoning block for commandcode");
}

// 9. OpenAI → OpenAI Responses: reasoning_content → reasoning item
{
  const body = { messages: [{ role: "user", content: "u" }, { role: "assistant", content: "a", reasoning_content: "responses reasoning" }] };
  const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "m", body, true);
  const reasoningItem = out.input.find(i => i.type === "reasoning");
  assert.ok(reasoningItem, "reasoning item present in responses input");
  assert.equal(reasoningItem.summary[0].text, "responses reasoning", "reasoning_content → reasoning summary for responses");
}

// 10. Gemini → OpenAI: thought:true → reasoning_content
{
  const body = {
    contents: [
      { role: "user", parts: [{ text: "u" }] },
      { role: "model", parts: [{ thought: true, text: "gemini thinking" }, { text: "gemini answer" }] }
    ]
  };
  const out = translateRequest(FORMATS.GEMINI, FORMATS.OPENAI, "m", body, true);
  const assistant = out.messages.find(m => m.role === "assistant");
  assert.equal(assistant.reasoning_content, "gemini thinking", "thought:true → reasoning_content for gemini");
}

// 11. Native Claude (provider === "claude"): unsigned thinking kept with DEFAULT signature.
// translateRequest(..., "anthropic") skips handlesThinkingBlocks and cannot see this filter.
{
  const body = {
    messages: [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1", reasoning_content: "r1" },
      { role: "user", content: "u2" }
    ]
  };
  const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4.5", body, true, {}, "claude");
  const assistant = out.messages.find(m => m.role === "assistant");
  const thinking = assistant.content.find(b => b.type === "thinking");
  assert.equal(thinking.thinking, "r1", "native: thinking text preserved");
  assert.equal(thinking.signature, DEFAULT_THINKING_CLAUDE_SIGNATURE, "native: DEFAULT bypass signature attached");
  const text = assistant.content.find(b => b.type === "text");
  assert.equal(text.text, "a1", "native: visible text unchanged");
  assert.equal(text.text.includes("r1"), false, "native: thoughts not in visible content");
}

// 12. Native Claude: foreign signature is replaced, not forwarded.
{
  const body = {
    messages: [
      { role: "user", content: "u" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "stolen", signature: "gAAAA-not-claude" },
          { type: "text", text: "a" }
        ]
      },
      { role: "user", content: "u2" }
    ]
  };
  const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4.5", body, true, {}, "claude");
  const assistant = out.messages.find(m => m.role === "assistant");
  const thinking = assistant.content.find(b => b.type === "thinking");
  assert.equal(thinking.thinking, "stolen", "native: thinking text kept after foreign-sig strip");
  assert.equal(thinking.signature, DEFAULT_THINKING_CLAUDE_SIGNATURE, "native: foreign blob not forwarded");
}

console.log("openaiToClaudeReasoningHistorySelfCheck: 12/12");
