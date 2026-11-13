// #2873: a Claude upstream answered to an OpenAI-format client must report the
// prompt-cache split in usage.prompt_tokens_details, on both the streaming and
// the non-streaming path. The translator computes it; the final usage rewrite
// used to drop it.
import { describe, it, expect } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { addBufferToUsage, filterUsageForFormat } from "../../open-sse/utils/usageTracking.js";

const USAGE = { input_tokens: 100, cache_read_input_tokens: 5000, cache_creation_input_tokens: 300 };

function sseStream(events) {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  return new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(body));
      c.close();
    },
  });
}

async function finalUsage(stream) {
  const text = await new Response(stream).text();
  const usages = text
    .split("\n")
    .filter((l) => l.startsWith("data: {"))
    .map((l) => JSON.parse(l.slice(6)).usage)
    .filter(Boolean);
  return usages.at(-1);
}

describe("#2873 Claude → OpenAI usage keeps the prompt-cache split", () => {
  it("streaming", async () => {
    const events = [
      { type: "message_start", message: { id: "m", model: "claude", role: "assistant", content: [], usage: { ...USAGE, output_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "pong" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } },
      { type: "message_stop" },
    ];
    const usage = await finalUsage(
      sseStream(events).pipeThrough(createSSETransformStreamWithLogger(FORMATS.CLAUDE, FORMATS.OPENAI, "claude", null, null, "claude")),
    );
    expect(usage.prompt_tokens_details).toEqual({ cached_tokens: 5000, cache_creation_tokens: 300 });
    expect(usage.prompt_tokens - usage.prompt_tokens_details.cached_tokens).toBeGreaterThanOrEqual(400);
    expect(usage.completion_tokens).toBe(7);
  });

  it("non-streaming", () => {
    const body = {
      id: "m",
      type: "message",
      model: "claude",
      role: "assistant",
      content: [{ type: "text", text: "pong" }],
      stop_reason: "end_turn",
      usage: { ...USAGE, output_tokens: 7 },
    };
    // Same two steps handleNonStreamingResponse applies.
    const translated = translateNonStreamingResponse(body, FORMATS.CLAUDE, FORMATS.OPENAI);
    const usage = filterUsageForFormat(addBufferToUsage(translated.usage), FORMATS.OPENAI);
    expect(usage.prompt_tokens_details).toEqual({ cached_tokens: 5000, cache_creation_tokens: 300 });
    expect(usage.prompt_tokens).toBeGreaterThanOrEqual(5400);
    expect(usage.completion_tokens).toBe(7);
  });
});
