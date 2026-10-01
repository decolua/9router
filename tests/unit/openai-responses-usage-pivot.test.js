import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

/**
 * Usage must survive the PIVOT, not just the direct openai:openai-responses route.
 *
 * Codex talks the Responses API, so routing it at a Claude connection runs
 * claude -> openai -> openai-responses. The converter that attaches usage to
 * response.completed is the second hop, and it only ever sees the intermediate
 * OpenAI chunk — so whether Codex learns its context size depends on the first
 * hop putting usage on that intermediate chunk.
 *
 * Signature is (targetFormat, sourceFormat, ...) — targetFormat is what the
 * UPSTREAM speaks, sourceFormat is what the CLIENT speaks.
 */
async function runTransform(chunks, targetFormat, provider) {
  const encoder = new TextEncoder();
  const input = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("");

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });

  const output = stream.pipeThrough(
    createSSETransformStreamWithLogger(
      targetFormat,
      FORMATS.OPENAI_RESPONSES,
      provider,
      null,
      null,
      "claude-sonnet-5",
    ),
  );

  const reader = output.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

function completedResponse(output) {
  const lines = output
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l.includes('"type":"response.completed"'));
  expect(lines.length, "expected exactly one response.completed").toBe(1);
  return JSON.parse(lines[0].slice(6)).response;
}

// Anthropic splits the counts across two events: message_start carries the whole
// prompt side (input + both cache buckets), message_delta carries only the output
// side. Neither event alone is the total, which is why the claude converter merges
// them into state before emitting the intermediate chunk.
const CLAUDE_CHUNKS_WITH_USAGE = [
  {
    type: "message_start",
    message: {
      id: "msg_01CfUtmFqMv3Gc5s66ehaTK",
      model: "claude-sonnet-5",
      usage: {
        input_tokens: 1500,
        cache_read_input_tokens: 12000,
        cache_creation_input_tokens: 300,
        output_tokens: 1,
      },
    },
  },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 42 } },
  { type: "message_stop" },
];

describe("OpenAI Responses usage across the pivot", () => {
  // The reported failure: a Codex session on a Claude connection grew unbounded
  // (101 -> 503 -> 631 messages) until Anthropic rejected it with
  // "prompt is too long: 1676806 tokens > 1000000 maximum", because every
  // token_count event Codex recorded had info: null.
  it("reports claude usage on response.completed so Codex can auto-compact", async () => {
    const output = await runTransform(CLAUDE_CHUNKS_WITH_USAGE, FORMATS.CLAUDE, "claude");

    // prompt side = input + cache_read + cache_creation = 1500 + 12000 + 300.
    expect(completedResponse(output).usage).toEqual({
      input_tokens: 13800,
      output_tokens: 42,
      total_tokens: 13842,
      input_tokens_details: { cached_tokens: 12000 },
    });
  });

  // Codex deserializes usage into a struct whose three top-level counts are all
  // required, so dropping any one of them discards the whole object and leaves the
  // context gauge empty — the same end state as reporting nothing.
  it("always reports all three top-level counts", async () => {
    const output = await runTransform(CLAUDE_CHUNKS_WITH_USAGE, FORMATS.CLAUDE, "claude");
    const usage = completedResponse(output).usage;

    for (const field of ["input_tokens", "output_tokens", "total_tokens"]) {
      expect(usage, `missing ${field}`).toHaveProperty(field);
      expect(Number.isFinite(usage[field]), `${field} must be a number`).toBe(true);
    }
  });
});
