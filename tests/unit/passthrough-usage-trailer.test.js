// Regression: passthrough streams that carry finish_reason on one chunk and the
// real usage on a LATER chunk with an empty delta (e.g. SinarCloud-style
// OpenAI-compatible suppliers) must not bill the cached input at the full rate.
//
// Before the fix the usage-only trailer failed hasValuableContent() and was
// dropped before extractUsage(), while the finish chunk injected an estimate
// that overwrote the accumulation — usageHistory recorded cached_tokens: 0.
import { describe, it, expect } from "vitest";

import { createSSEStream } from "../../open-sse/utils/stream.js";

const contentChunk = JSON.stringify({
  id: "chatcmpl-trailer",
  object: "chat.completion.chunk",
  created: 1794467083,
  model: "m",
  choices: [{ index: 0, delta: { content: "OK" }, finish_reason: null, logprobs: null }],
});

const finishChunk = JSON.stringify({
  id: "chatcmpl-trailer",
  object: "chat.completion.chunk",
  created: 1794467083,
  model: "m",
  choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: "length", logprobs: null }],
  usage: null,
});

const usageTrailer = JSON.stringify({
  id: "chatcmpl-trailer",
  object: "chat.completion.chunk",
  created: 1794467083,
  model: "m",
  choices: [{ index: 0, delta: {}, finish_reason: null, logprobs: null }],
  usage: {
    prompt_tokens: 1437,
    prompt_tokens_details: { cached_tokens: 1344, cache_write_tokens: 0 },
    completion_tokens: 5,
    total_tokens: 1442,
  },
});

async function run(chunks) {
  let completed = null;
  const stream = createSSEStream({
    mode: "passthrough",
    provider: "openai",
    body: { model: "m", messages: [{ role: "user", content: "hi" }] },
    onStreamComplete: (_content, usage) => {
      completed = usage;
    },
  });
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const decoder = new TextDecoder();
  const readPromise = (async () => {
    let out = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
    return out;
  })();
  await writer.write(new TextEncoder().encode(chunks.map((c) => `data: ${c}\n\n`).join("")));
  await writer.close();
  const out = await readPromise;
  return { out, completed };
}

describe("passthrough usage-only trailer", () => {
  it("keeps the real cache count instead of an estimate", async () => {
    const { out, completed } = await run([contentChunk, finishChunk, usageTrailer]);
    // The trailer must reach the client (standard OpenAI include_usage shape).
    expect(out).toContain('"cached_tokens":1344');
    // And billing/logging must see the real usage, not an estimate.
    expect(completed).not.toBeNull();
    expect(completed.estimated).toBeUndefined();
    expect(completed.prompt_tokens).toBe(1437);
  });

  it("still estimates when upstream never sends usage", async () => {
    const { completed } = await run([contentChunk, finishChunk]);
    expect(completed).not.toBeNull();
    expect(completed.estimated).toBe(true);
  });
});
