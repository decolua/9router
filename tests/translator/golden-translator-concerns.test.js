// P0 GOLDEN (refactor2): lock OUTPUT translateResponse/Request cho các concern
// SẮP refactor ở P1-P4 (usage field-map, finishReasonMap, reasoningDelta).
// Bổ sung coverage còn thiếu so với golden-response-stream.test.js:
//   - commandcode usage/finish
//   - passthrough openai→openai (request + response)
//   - kiro/ollama finish_reason sau tool (lock behavior HIỆN TẠI, kể cả bug đã biết)
// Sau refactor chạy lại phải khớp y hệt. Lệch = regression.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest, translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Strip volatile id/created so snapshots are stable across runs.
function stripVolatile(chunks) {
  return JSON.parse(JSON.stringify(chunks), (key, val) => {
    if (key === "created") return 0;
    if (key === "id" && typeof val === "string") {
      return val
        .replace(/-\d{10,}-(\d+)$/, "-<TS>-$1")
        .replace(/^chatcmpl-\d{10,}$/, "chatcmpl-<TS>")
        .replace(/^call_(\d+)_\d{10,}$/, "call_$1_<TS>")
        .replace(/^call_\d{10,}_(\d+)$/, "call_<TS>_$1");
    }
    return val;
  });
}

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

describe("GOLDEN response stream: CommandCode → OpenAI", () => {
  it("text + reasoning + tool + finish-step usage", () => {
    const events = [
      { type: "text-delta", text: "Hello" },
      { type: "reasoning-delta", text: "thinking" },
      { type: "tool-input-start", id: "t1", toolName: "get_weather" },
      { type: "tool-input-delta", id: "t1", delta: '{"city":"NYC"}' },
      { type: "finish-step", finishReason: "tool-calls", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      { type: "finish" },
    ];
    expect(runStream(FORMATS.COMMANDCODE, FORMATS.OPENAI, events)).toMatchSnapshot();
  });
});

describe("GOLDEN response stream: Kiro → OpenAI (finish after tool)", () => {
  it("toolUse then stop — lock current finish_reason behavior", () => {
    const events = [
      { assistantResponseEvent: { content: "Hi" }, _eventType: "assistantResponseEvent" },
      { toolUseEvent: { toolUseId: "tu_1", name: "search", input: { q: "x" } }, _eventType: "toolUseEvent" },
      { usageEvent: { inputTokens: 7, outputTokens: 3 }, _eventType: "usageEvent" },
      { _eventType: "messageStopEvent" },
    ];
    expect(runStream(FORMATS.KIRO, FORMATS.OPENAI, events)).toMatchSnapshot();
  });
});

describe("GOLDEN response stream: Ollama → OpenAI (finish after tool)", () => {
  it("tool_calls then done_reason=stop — lock current finish_reason", () => {
    const events = [
      { model: "qwen3", message: { role: "assistant", tool_calls: [{ function: { name: "search", arguments: { q: "x" } } }] } },
      { model: "qwen3", done: true, done_reason: "stop", prompt_eval_count: 5, eval_count: 2 },
    ];
    expect(runStream(FORMATS.OLLAMA, FORMATS.OPENAI, events)).toMatchSnapshot();
  });
});

describe("GOLDEN passthrough: same format = no translation", () => {
  it("response openai→openai returns chunk unchanged", () => {
    const chunk = { id: "chatcmpl-x", object: "chat.completion.chunk", created: 1, model: "gpt-4o", choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }] };
    const state = initState(FORMATS.OPENAI);
    const out = translateResponse(FORMATS.OPENAI, FORMATS.OPENAI, chunk, state);
    expect(out).toEqual([chunk]);
  });

  it("request openai→openai keeps messages (filterToOpenAIFormat normalize)", () => {
    const body = { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "gpt-4o", body, true);
    expect(out.messages).toEqual([{ role: "user", content: "hi" }]);
  });
});

describe("GOLDEN usage math: Claude prompt = input + cache (lock)", () => {
  it("prompt_tokens sums input + cache_read + cache_creation", () => {
    const events = [
      { type: "message_start", message: { id: "msg_1", model: "claude-opus-4-6" } },
      { type: "content_block_start", index: 0, content_block: { type: "text" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 } },
      { type: "message_stop" },
    ];
    const out = runStream(FORMATS.CLAUDE, FORMATS.OPENAI, events);
    const finalChunk = out.find(c => c.usage);
    expect(finalChunk.usage.prompt_tokens).toBe(15); // 10 + 3 + 2
    expect(finalChunk.usage.completion_tokens).toBe(5);
    expect(finalChunk.usage).toMatchSnapshot();
  });
});
