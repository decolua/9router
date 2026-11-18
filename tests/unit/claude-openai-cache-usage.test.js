// Claude upstream -> OpenAI client: cache read/creation counts must reach the client.
//
// The translator builds the final OpenAI usage with prompt_tokens_details.cached_tokens,
// but the stream layer replaced it with state.usage, whose Claude field names
// (cache_read_input_tokens) are dropped by the OpenAI usage filter. OpenAI-compatible
// clients (Kilo Code, opencode, ...) therefore saw every Claude request as uncached.
// Token numbers below come from a real claude-sonnet request logged by 9Router.
import { describe, it, expect } from "vitest";
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

const BUFFER = 2000;

function claudeEvents({ input = 44, cacheRead = 0, cacheCreation = 0, output = 4, stopReason = "end_turn" } = {}) {
  const startUsage = { input_tokens: input, cache_creation_input_tokens: cacheCreation, cache_read_input_tokens: cacheRead, output_tokens: 1 };
  return [
    { type: "message_start", message: { id: "msg_1", model: "claude-sonnet-5-5", role: "assistant", content: [], usage: startUsage } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "OK" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: stopReason ? { stop_reason: stopReason, stop_sequence: null } : {}, usage: { ...startUsage, output_tokens: output } },
    { type: "message_stop" },
  ];
}

function sse(events) {
  const encoder = new TextEncoder();
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new ReadableStream({ start(c) { c.enqueue(encoder.encode(body)); c.close(); } });
}

async function drain(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += typeof value === "string" ? value : decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function clientUsage(events) {
  const out = await drain(sse(events).pipeThrough(
    createSSETransformStreamWithLogger(FORMATS.CLAUDE, FORMATS.OPENAI, "claude", null, null, "claude-sonnet-5-5"),
  ));
  const chunks = out.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]").map((l) => JSON.parse(l.slice(6)));
  return chunks.filter((c) => c.usage).at(-1)?.usage;
}

describe("Claude -> OpenAI stream: cache usage reaches the client", () => {
  it("forwards cache reads as prompt_tokens_details.cached_tokens", async () => {
    const usage = await clientUsage(claudeEvents({ cacheRead: 15271 }));
    expect(usage.prompt_tokens).toBe(44 + 15271 + BUFFER);
    expect(usage.prompt_tokens_details?.cached_tokens).toBe(15271);
    expect(usage.completion_tokens).toBe(4);
  });

  it("forwards cache writes as prompt_tokens_details.cache_creation_tokens", async () => {
    const usage = await clientUsage(claudeEvents({ cacheCreation: 15271 }));
    expect(usage.prompt_tokens).toBe(44 + 15271 + BUFFER);
    expect(usage.prompt_tokens_details?.cache_creation_tokens).toBe(15271);
    expect(usage.prompt_tokens_details?.cached_tokens).toBeUndefined();
  });

  it("keeps the plain shape when there is no cache activity", async () => {
    const usage = await clientUsage(claudeEvents());
    expect(usage.prompt_tokens).toBe(44 + BUFFER);
    expect(usage.prompt_tokens_details).toBeUndefined();
  });
});

describe("claude-to-openai: message_stop fallback uses the same usage math", () => {
  it("includes cache in prompt_tokens when message_delta carried no stop_reason", () => {
    const state = {};
    const out = [];
    for (const ev of claudeEvents({ cacheRead: 15271, stopReason: null })) {
      const r = claudeToOpenAIResponse(ev, state);
      if (Array.isArray(r)) out.push(...r); else if (r) out.push(r);
    }
    const usage = out.filter((c) => c.usage).at(-1)?.usage;
    expect(usage.prompt_tokens).toBe(44 + 15271);
    expect(usage.prompt_tokens_details?.cached_tokens).toBe(15271);
  });
});
