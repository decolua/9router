// Streaming latency metrics on the 📊 DONE line: TTFT, output rate (tok/s) and the
// longest stall between output chunks.
//
// TTFT used to be stamped on the first upstream byte, so a provider that opens with
// a role-only or ping chunk reported a TTFT that was too small and an output rate
// that was too low. These pin the timing to chunks that actually carry output.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isOutputChunk } from "../../open-sse/utils/streamHelpers.js";
import { createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { formatDoneLine } from "../../open-sse/handlers/chatCore/requestDetail.js";
import { outputTokensPerSecond } from "../../open-sse/utils/outputRate.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const openaiDelta = (delta, finish_reason = null) => ({
  id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: "m",
  choices: [{ index: 0, delta, finish_reason }],
});

describe("isOutputChunk", () => {
  it("ignores an OpenAI role-only chunk", () => {
    expect(isOutputChunk(openaiDelta({ role: "assistant", content: "" }))).toBe(false);
  });

  it("detects OpenAI content", () => {
    expect(isOutputChunk(openaiDelta({ content: "hi" }))).toBe(true);
  });

  it("detects OpenAI reasoning_content", () => {
    expect(isOutputChunk(openaiDelta({ reasoning_content: "hmm" }))).toBe(true);
  });

  it("detects OpenAI tool-call fragments", () => {
    expect(isOutputChunk(openaiDelta({ tool_calls: [{ index: 0, function: { arguments: "{" } }] }))).toBe(true);
  });

  it("ignores an OpenAI usage-only trailer", () => {
    expect(isOutputChunk({ id: "x", choices: [], usage: { prompt_tokens: 1, completion_tokens: 2 } })).toBe(false);
  });

  it("ignores Claude message_start", () => {
    expect(isOutputChunk({ type: "message_start", message: { id: "msg_1" } })).toBe(false);
  });

  it("detects a Claude text delta", () => {
    expect(isOutputChunk({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } })).toBe(true);
  });

  it("detects a Claude tool input delta", () => {
    expect(isOutputChunk({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"a\"" } })).toBe(true);
  });

  it("detects a Claude content_block_start, which opens hidden thinking", () => {
    expect(isOutputChunk({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } })).toBe(true);
  });

  it("ignores Responses response.created", () => {
    expect(isOutputChunk({ type: "response.created", response: { id: "resp_1" } })).toBe(false);
  });

  it("detects a Responses output_text delta", () => {
    expect(isOutputChunk({ type: "response.output_text.delta", delta: "hi" })).toBe(true);
  });

  it("detects a Responses reasoning summary delta", () => {
    expect(isOutputChunk({ type: "response.reasoning_summary_text.delta", delta: "hmm" })).toBe(true);
  });

  it("detects Gemini text parts, wrapped or not", () => {
    const candidates = [{ content: { parts: [{ text: "hi" }] } }];
    expect(isOutputChunk({ candidates })).toBe(true);
    expect(isOutputChunk({ response: { candidates } })).toBe(true);
  });

  it("ignores a Gemini usage-only chunk", () => {
    expect(isOutputChunk({ usageMetadata: { promptTokenCount: 3 } })).toBe(false);
  });

  it("detects Ollama message content", () => {
    expect(isOutputChunk({ message: { role: "assistant", content: "hi" }, done: false })).toBe(true);
  });
});

describe("stream output timing", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
  afterEach(() => { vi.useRealTimers(); });

  // Writes each [atMs, sseText] step at its own fake clock time and returns the
  // timing object handed to onStreamComplete.
  async function runTimed(stream, steps) {
    let timing = null;
    const done = new Promise((resolve) => { stream.onComplete = (_c, _u, t) => { timing = t; resolve(); }; });
    const writer = stream.transform.writable.getWriter();
    const reading = (async () => { for await (const _ of stream.transform.readable) { /* drain */ } })();
    const encoder = new TextEncoder();
    for (const [atMs, text] of steps) {
      vi.setSystemTime(atMs);
      await writer.write(encoder.encode(text));
    }
    await writer.close();
    await reading;
    await done;
    return timing;
  }

  const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

  function passthrough() {
    const holder = {};
    holder.transform = createPassthroughStreamWithLogger("openai", null, "m", null, null, (...args) => holder.onComplete(...args), null);
    return holder;
  }

  const OPENAI_STEPS = [
    [1000, sse(openaiDelta({ role: "assistant", content: "" }))],
    [1500, sse(openaiDelta({ content: "a" }))],
    [1600, sse(openaiDelta({ content: "b" }))],
    [3600, sse(openaiDelta({ content: "c" }))],
    [3700, sse(openaiDelta({}, "stop")) + "data: [DONE]\n\n"],
  ];

  it("stamps the first token on the first output chunk, not the role chunk", async () => {
    const timing = await runTimed(passthrough(), OPENAI_STEPS);
    expect(timing.firstTokenAt).toBe(1500);
  });

  it("stamps the last token on the last output chunk", async () => {
    const timing = await runTimed(passthrough(), OPENAI_STEPS);
    expect(timing.lastTokenAt).toBe(3600);
  });

  it("records the longest gap between output chunks", async () => {
    const timing = await runTimed(passthrough(), OPENAI_STEPS);
    expect(timing.maxGapMs).toBe(2000);
  });

  // Shape captured from claude-opus-5-5 with redacted thinking: the thinking block
  // opens right after message_start, its 610 tokens are generated invisibly, and the
  // only thinking delta (empty + signature) arrives ~5s later together with the tool
  // call. output_tokens counts the thinking, so the window must open at the block start.
  it("opens the window at the Claude block start when thinking is redacted", async () => {
    const holder = {};
    holder.transform = createSSETransformStreamWithLogger(
      FORMATS.CLAUDE, FORMATS.CLAUDE, "claude", null, null, "m", null, null, (...args) => holder.onComplete(...args),
    );
    const timing = await runTimed(holder, [
      [676, `event: message_start\n${sse({ type: "message_start", message: { id: "msg_1", role: "assistant", model: "m", usage: { input_tokens: 1, output_tokens: 0 } } })}` +
        `event: content_block_start\n${sse({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } })}`],
      [5586, `event: content_block_delta\n${sse({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "" } })}` +
        `event: content_block_delta\n${sse({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } })}` +
        `event: content_block_stop\n${sse({ type: "content_block_stop", index: 0 })}` +
        `event: content_block_start\n${sse({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "w", input: {} } })}`],
      [8900, `event: content_block_delta\n${sse({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{}" } })}`],
      [8918, `event: message_stop\n${sse({ type: "message_stop" })}`],
    ]);
    expect(timing.firstTokenAt).toBe(676);
  });

  it("measures translated Claude streams from the first content block", async () => {
    const holder = {};
    holder.transform = createSSETransformStreamWithLogger(
      FORMATS.CLAUDE, FORMATS.OPENAI, "claude", null, null, "m", null, null, (...args) => holder.onComplete(...args),
    );
    const timing = await runTimed(holder, [
      [1000, `event: message_start\n${sse({ type: "message_start", message: { id: "msg_1", role: "assistant", model: "m", usage: { input_tokens: 1, output_tokens: 0 } } })}`],
      [1200, `event: content_block_start\n${sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}`],
      [1400, `event: content_block_delta\n${sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "a" } })}`],
      [1900, `event: content_block_delta\n${sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "b" } })}`],
      [2000, `event: message_stop\n${sse({ type: "message_stop" })}`],
    ]);
    expect(timing).toEqual({ firstTokenAt: 1200, lastTokenAt: 1900, maxGapMs: 500 });
  });

  it("falls back to the first byte when no chunk is recognised as output", async () => {
    const timing = await runTimed(passthrough(), [
      [1000, sse({ id: "x", object: "unknown.event" })],
      [1300, "data: [DONE]\n\n"],
    ]);
    expect(timing.firstTokenAt).toBe(1000);
  });
});

describe("outputTokensPerSecond", () => {
  it("excludes the first token from the rate", () => {
    expect(outputTokensPerSecond({ completion_tokens: 301 }, { generation: 2000 })).toBe(150);
  });

  it("reads Claude-style output_tokens", () => {
    expect(outputTokensPerSecond({ output_tokens: 101 }, { generation: 1000 })).toBe(100);
  });

  it("returns null for rows saved without a generation window", () => {
    expect(outputTokensPerSecond({ completion_tokens: 300 }, { ttft: 500, total: 2500 })).toBeNull();
  });

  it("returns null for a single output token", () => {
    expect(outputTokensPerSecond({ completion_tokens: 1 }, { generation: 1000 })).toBeNull();
  });
});

describe("formatDoneLine", () => {
  const usage = { prompt_tokens: 100, completion_tokens: 300 };

  it("appends the output rate from the generation window", () => {
    const line = formatDoneLine({ usage, latency: { total: 2500, ttft: 500, generation: 2000, maxGap: 0 } });
    expect(line).toContain("OUT 300 (150 tok/s)");
  });

  it("shows the longest gap between output chunks", () => {
    const line = formatDoneLine({ usage, latency: { total: 2500, ttft: 500, generation: 2000, maxGap: 1234 } });
    expect(line).toBe("DONE 2500ms · TTFT 500ms · MAX GAP 1234ms · IN 100 · OUT 300 (150 tok/s)");
  });

  it("omits the rate and gap for non-streaming requests", () => {
    const line = formatDoneLine({ usage, latency: { total: 2500 } });
    expect(line).toBe("DONE 2500ms · IN 100 · OUT 300");
  });

  it("omits the rate when the whole output arrived in one chunk", () => {
    const line = formatDoneLine({ usage, latency: { total: 2500, ttft: 500, generation: 0, maxGap: 0 } });
    expect(line).toBe("DONE 2500ms · TTFT 500ms · IN 100 · OUT 300");
  });
});
