import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
}));

import "../../open-sse/translator/index.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";

// #4673: an OpenAI client talking to a Claude upstream. Claude reports
// input_tokens EXCLUDING cache; the stored prompt must be input + read + write,
// counted once.
const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

async function run(events) {
  let finalUsage = null;
  const ts = createSSETransformStreamWithLogger("claude", "openai", "claude", null, null, "claude-x", "c1",
    { messages: [{ role: "user", content: "hi" }] }, (_c, u) => { finalUsage = u; }, null);
  const writer = ts.writable.getWriter();
  const reader = ts.readable.getReader();
  const pump = (async () => { while (!(await reader.read()).done); })();
  const enc = new TextEncoder();
  for (const e of events) await writer.write(enc.encode(e));
  await writer.close();
  await pump;
  return finalUsage;
}

describe("Claude upstream -> OpenAI client usage", () => {
  it("stores prompt = input + cache_read + cache_write, not cache twice", async () => {
    const u = await run([
      sse("message_start", { type: "message_start", message: { id: "m1", model: "claude-x", usage: { input_tokens: 255, output_tokens: 1, cache_read_input_tokens: 228399, cache_creation_input_tokens: 253 } } }),
      sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "OK" } }),
      sse("content_block_stop", { type: "content_block_stop", index: 0 }),
      sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 302 } }),
      sse("message_stop", { type: "message_stop" }),
    ]);
    const stored = canonicalizeUsage(u);
    expect(stored.prompt_tokens).toBe(255 + 228399 + 253);
    expect(stored.cached_tokens).toBe(228399);
    expect(stored.cache_creation_input_tokens).toBe(253);
  });

  it("non-stream: client sees the cache-inclusive prompt and cached_tokens", () => {
    const out = translateNonStreamingResponse({
      id: "m1", type: "message", role: "assistant", model: "claude-x",
      content: [{ type: "text", text: "OK" }], stop_reason: "end_turn",
      usage: { input_tokens: 489, output_tokens: 387, cache_read_input_tokens: 4702, cache_creation_input_tokens: 2 },
    }, "claude", "openai");
    expect(out.usage.prompt_tokens).toBe(489 + 4702 + 2);
    expect(out.usage.prompt_tokens_details).toEqual({ cached_tokens: 4702, cache_creation_tokens: 2 });
  });
});
