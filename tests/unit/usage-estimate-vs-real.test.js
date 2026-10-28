import { describe, it, expect } from "vitest";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";
import { mergeUsage, estimateUsage } from "../../open-sse/utils/usageTracking.js";

// OpenAI Chat Completions with stream_options.include_usage sends finish_reason
// one chunk BEFORE the usage trailer. The stream layer injects an estimate on
// the finish chunk (JSON body length / 4). A base64 image makes that estimate
// enormous; the real usage that arrives next must replace it, not be max-merged.

const IMAGE_BASE64 = "A".repeat(2_000_000); // ~1.5 MB image as a data URL
const body = {
  model: "gpt-test",
  stream: true,
  stream_options: { include_usage: true },
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "describe this image" },
      { type: "image_url", image_url: { url: `data:image/png;base64,${IMAGE_BASE64}` } },
    ],
  }],
};

const REAL = { prompt_tokens: 1_105, completion_tokens: 12, total_tokens: 1_117 };

const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

async function runOpenAIStream() {
  const encoder = new TextEncoder();
  const upstream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sse({ id: "c1", choices: [{ index: 0, delta: { content: "A red square." } }] })));
      controller.enqueue(encoder.encode(sse({ id: "c1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })));
      controller.enqueue(encoder.encode(sse({ id: "c1", choices: [], usage: REAL })));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  let recorded = null;
  const onStreamComplete = (_content, usage) => { recorded = usage; };
  const out = upstream.pipeThrough(
    createPassthroughStreamWithLogger("openai", null, "gpt-test", null, body, onStreamComplete, null),
  );

  const reader = out.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  const chunks = text.split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)));
  return { recorded, chunks };
}

describe("estimated usage must not survive real usage (OpenAI stream, image body)", () => {
  it("the body-length estimate is orders of magnitude above real usage", () => {
    expect(estimateUsage(body, 13).prompt_tokens).toBeGreaterThan(400_000);
  });

  it("records the provider's real usage, not the estimate", async () => {
    const { recorded } = await runOpenAIStream();
    expect(recorded.prompt_tokens).toBe(REAL.prompt_tokens);
    expect(recorded.completion_tokens).toBe(REAL.completion_tokens);
    expect(recorded.estimated).toBeFalsy();
  });

  it("forwards the real usage trailer to the client unchanged", async () => {
    const { chunks } = await runOpenAIStream();
    expect(chunks.at(-1).usage).toEqual(REAL);
  });
});

describe("mergeUsage estimate precedence", () => {
  const estimate = { prompt_tokens: 500_000, completion_tokens: 2_003, total_tokens: 502_003, estimated: true };

  it("real usage replaces an earlier estimate", () => {
    expect(mergeUsage(estimate, REAL)).toEqual(REAL);
  });

  it("a later estimate never overrides real usage", () => {
    expect(mergeUsage(REAL, estimate)).toEqual(REAL);
  });

  it("output-only real usage does not wipe the estimate's input", () => {
    const merged = mergeUsage(estimate, { prompt_tokens: 0, completion_tokens: 40 });
    expect(merged.prompt_tokens).toBe(500_000);
  });

  it("still max-merges Anthropic's split real usage", () => {
    const start = { prompt_tokens: 100, completion_tokens: 1, cache_read_input_tokens: 200 };
    const delta = { prompt_tokens: 0, completion_tokens: 50 };
    expect(mergeUsage(start, delta)).toEqual({ prompt_tokens: 100, completion_tokens: 50, cache_read_input_tokens: 200 });
  });
});
