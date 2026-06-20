// P0 GOLDEN: lock OUTPUT của translateResponse (stream) cho các concern đặc biệt.
// Feed chuỗi chunk THẬT (shape provider) → snapshot mảng chunk openai emit.
// Sau refactor chạy lại phải khớp y hệt (chunk/usage/thinking/tool/finish).
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Chuẩn hoá field động (Date.now trong created + id) để snapshot ổn định.
function stripVolatile(chunks) {
  return JSON.parse(JSON.stringify(chunks), (key, val) => {
    if (key === "created") return 0;
    if (key === "id" && typeof val === "string") {
      return val
        .replace(/-\d{10,}-(\d+)$/, "-<TS>-$1")   // gemini: name-<ts>-idx
        .replace(/^chatcmpl-\d{10,}$/, "chatcmpl-<TS>")  // kiro/ollama stream id
        .replace(/^call_(\d+)_\d{10,}$/, "call_$1_<TS>"); // ollama tool id
    }
    return val;
  });
}

// Chạy 1 chuỗi event qua translateResponse, gom toàn bộ chunk emit.
function runStream(targetFormat, sourceFormat, events) {
  const state = initState(sourceFormat);
  const all = [];
  for (const ev of events) {
    const out = translateResponse(targetFormat, sourceFormat, ev, state);
    if (Array.isArray(out)) all.push(...out);
    else if (out) all.push(out);
  }
  return stripVolatile(all);
}

describe("GOLDEN response stream: Claude → OpenAI", () => {
  it("text + thinking + tool_use + usage + finish", () => {
    const events = [
      { type: "message_start", message: { id: "msg_1", model: "claude-opus-4-6" } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "let me think" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hello" } },
      { type: "content_block_stop", index: 1 },
      { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "tu_1", name: "get_weather" } },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"city":"NYC"}' } },
      { type: "content_block_stop", index: 2 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 } },
      { type: "message_stop" },
    ];
    expect(runStream(FORMATS.CLAUDE, FORMATS.OPENAI, events)).toMatchSnapshot();
  });
});

describe("GOLDEN response stream: Gemini → OpenAI", () => {
  it("text + thought(no-sig) + functionCall + usage + finish", () => {
    const events = [
      { candidates: [{ content: { parts: [{ text: "thinking part", thought: true }] } }], responseId: "resp_1", modelVersion: "gemini-3-pro" },
      { candidates: [{ content: { parts: [{ text: "Answer" }] } }] },
      { candidates: [{ content: { parts: [{ functionCall: { name: "search", args: { q: "x" } } }] } }] },
      { candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4, thoughtsTokenCount: 2, totalTokenCount: 14, cachedContentTokenCount: 1 } },
    ];
    expect(runStream(FORMATS.GEMINI, FORMATS.OPENAI, events)).toMatchSnapshot();
  });

  it("image output (inlineData → delta.images)", () => {
    const events = [
      { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "BASE64DATA" } }] } }], responseId: "resp_2", modelVersion: "gemini-3-flash-image" },
      { candidates: [{ finishReason: "STOP" }] },
    ];
    expect(runStream(FORMATS.GEMINI, FORMATS.OPENAI, events)).toMatchSnapshot();
  });
});

describe("GOLDEN response stream: Kiro → OpenAI", () => {
  it("text + reasoning + toolUse + usage + stop", () => {
    const events = [
      { assistantResponseEvent: { content: "Hello" }, _eventType: "assistantResponseEvent" },
      { reasoningContentEvent: { text: "thinking" }, _eventType: "reasoningContentEvent" },
      { toolUseEvent: { toolUseId: "tu_1", name: "get_weather", input: { city: "NYC" } }, _eventType: "toolUseEvent" },
      { usageEvent: { inputTokens: 10, outputTokens: 5 }, _eventType: "usageEvent" },
      { _eventType: "messageStopEvent" },
    ];
    expect(runStream(FORMATS.KIRO, FORMATS.OPENAI, events)).toMatchSnapshot();
  });
});

describe("GOLDEN response stream: Ollama → OpenAI", () => {
  it("content + thinking + tool_calls + done usage", () => {
    const events = [
      { model: "qwen3", message: { role: "assistant", content: "Hi", thinking: "reason" } },
      { model: "qwen3", message: { role: "assistant", tool_calls: [{ function: { name: "search", arguments: { q: "x" } } }] } },
      { model: "qwen3", done: true, done_reason: "stop", prompt_eval_count: 8, eval_count: 4 },
    ];
    expect(runStream(FORMATS.OLLAMA, FORMATS.OPENAI, events)).toMatchSnapshot();
  });
});

describe("GOLDEN response stream: OpenAI-Responses (codex) → OpenAI", () => {
  it("text + reasoning + tool_call + completed usage", () => {
    const events = [
      { type: "response.output_text.delta", delta: "Hello" },
      { type: "response.reasoning_summary_text.delta", delta: "thinking" },
      { type: "response.output_item.added", item: { type: "function_call", call_id: "call_1", name: "get_weather" } },
      { type: "response.function_call_arguments.delta", delta: '{"city":"NYC"}' },
      { type: "response.output_item.done", item: { type: "function_call" } },
      { type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 3 } } } },
    ];
    expect(runStream(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, events)).toMatchSnapshot();
  });

  it("error event → error chunk (fallback id/created)", () => {
    const events = [
      { type: "error", error: { message: "model_not_found" } },
    ];
    expect(runStream(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, events)).toMatchSnapshot();
  });
});
