// Regression: Claude thinking must NOT leak literal <think>/</think> markers
// into OpenAI delta.content.
//
// History (the tug-of-war this test ends):
//   85b7a0b  moved thinking text to reasoning_content ("mixed with actual
//            response" fix) but left the literal "<think>" start marker behind.
//   #454     re-added a literal "</think>" close marker because the Responses
//            pipeline needed an explicit "reasoning ended" signal.
// The markers are a private convention — only openai-responses.js understood
// them. Any EXTERNAL OpenAI consumer (Claude Code / Zed behind a downstream
// proxy, plain OpenAI SDK) renders them as visible text, and a downstream
// proxy rebuilding a Claude message puts a text block before the thinking
// block, which makes clients silently drop the thinking content entirely.
//
// The fix: claude-to-openai.js emits NO content for thinking block boundaries
// (text flows via reasoning_content), and openai-responses.js closes the
// reasoning section on the reasoning_content → content state transition —
// satisfying #454 without literal markers on the wire.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

function runStream(targetFormat, sourceFormat, events) {
  const state = initState(sourceFormat);
  const all = [];
  for (const ev of events) {
    const out = translateResponse(targetFormat, sourceFormat, ev, state);
    if (Array.isArray(out)) all.push(...out);
    else if (out) all.push(out);
  }
  return all;
}

const claudeThinkingThenText = [
  { type: "message_start", message: { id: "msg_1", model: "claude-sonnet-5" } },
  { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
  { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "let me think" } },
  { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: " harder" } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "text" } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hello" } },
  { type: "content_block_stop", index: 1 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { input_tokens: 10, output_tokens: 5 } },
  { type: "message_stop" },
];

describe("Claude → OpenAI: thinking block boundaries", () => {
  it("never emits literal <think>/</think> in delta.content", () => {
    const chunks = runStream(FORMATS.CLAUDE, FORMATS.OPENAI, claudeThinkingThenText);
    for (const chunk of chunks) {
      const content = chunk?.choices?.[0]?.delta?.content;
      if (typeof content === "string") {
        expect(content).not.toContain("<think>");
        expect(content).not.toContain("</think>");
      }
    }
  });

  it("delivers thinking text via reasoning_content and answer via content", () => {
    const chunks = runStream(FORMATS.CLAUDE, FORMATS.OPENAI, claudeThinkingThenText);
    const reasoning = chunks.map(c => c?.choices?.[0]?.delta?.reasoning_content || "").join("");
    const content = chunks.map(c => c?.choices?.[0]?.delta?.content || "").join("");
    expect(reasoning).toBe("let me think harder");
    expect(content).toBe("Hello");
  });
});

describe("OpenAI → Responses: reasoning closes on reasoning→content transition (#454)", () => {
  const openaiChunk = (delta, finish = null) => ({
    id: "chatcmpl-x",
    object: "chat.completion.chunk",
    created: 1,
    model: "claude-sonnet-5",
    choices: [{ index: 0, delta, finish_reason: finish }],
  });

  it("emits reasoning done events before the first output_text.delta", () => {
    const events = runStream(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, [
      openaiChunk({ role: "assistant" }),
      openaiChunk({ reasoning_content: "let me think" }),
      openaiChunk({ content: "Hello" }),
      openaiChunk({}, "stop"),
    ]);
    const types = events.map(e => e?.data?.type || e?.event);
    const reasoningDoneIdx = types.indexOf("response.reasoning_summary_text.done");
    const firstTextIdx = types.indexOf("response.output_text.delta");
    expect(reasoningDoneIdx).toBeGreaterThan(-1);
    expect(firstTextIdx).toBeGreaterThan(-1);
    expect(reasoningDoneIdx).toBeLessThan(firstTextIdx);
  });

  it("keeps inline <think> tag parsing working for providers that emit tags in content", () => {
    const events = runStream(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, [
      openaiChunk({ role: "assistant" }),
      openaiChunk({ content: "<think>raw reasoning" }),
      openaiChunk({ content: "</think>Answer" }),
      openaiChunk({}, "stop"),
    ]);
    const reasoning = events
      .filter(e => e?.data?.type === "response.reasoning_summary_text.delta")
      .map(e => e.data.delta).join("");
    const text = events
      .filter(e => e?.data?.type === "response.output_text.delta")
      .map(e => e.data.delta).join("");
    expect(reasoning).toBe("raw reasoning");
    expect(text).toBe("Answer");
  });
});

describe("Claude → Responses full pivot (the #454 end-to-end scenario)", () => {
  it("reasoning section closes before text, no literal tags anywhere", () => {
    const events = runStream(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, claudeThinkingThenText);
    const types = events.map(e => e?.data?.type || e?.event);

    const reasoningDoneIdx = types.indexOf("response.reasoning_summary_text.done");
    const firstTextIdx = types.indexOf("response.output_text.delta");
    expect(reasoningDoneIdx).toBeGreaterThan(-1);
    expect(firstTextIdx).toBeGreaterThan(-1);
    expect(reasoningDoneIdx).toBeLessThan(firstTextIdx);

    const reasoning = events
      .filter(e => e?.data?.type === "response.reasoning_summary_text.delta")
      .map(e => e.data.delta).join("");
    const text = events
      .filter(e => e?.data?.type === "response.output_text.delta")
      .map(e => e.data.delta).join("");
    expect(reasoning).toBe("let me think harder");
    expect(text).toBe("Hello");
    expect(text).not.toContain("<think>");
    expect(text).not.toContain("</think>");
  });
});
