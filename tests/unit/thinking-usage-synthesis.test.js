// Hidden-thinking synthesis: streams whose upstream never reports
// reasoning_tokens get the field synthesized into the CLIENT-facing usage
// chunk (every model, no opt-in) — the usage kept for stats/logging stays raw.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-thinking-synthesis-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("synthesizeThinkingTokens", () => {
  let synthesizeThinkingTokens;

  beforeAll(async () => {
    ({ synthesizeThinkingTokens } = await import("../../open-sse/utils/usageTracking.js"));
  });

  it("attributes 70% of completion tokens when output exceeds the threshold", () => {
    const result = synthesizeThinkingTokens({ prompt_tokens: 10, completion_tokens: 100, total_tokens: 110 });
    expect(result.completion_tokens_details.reasoning_tokens).toBe(70);
    // other fields pass through unchanged
    expect(result.prompt_tokens).toBe(10);
    expect(result.completion_tokens).toBe(100);
    expect(result.total_tokens).toBe(110);
  });

  it("floors the synthesized value", () => {
    // floor(11 * 0.7) = floor(7.7)
    expect(synthesizeThinkingTokens({ completion_tokens: 11 }).completion_tokens_details.reasoning_tokens).toBe(7);
  });

  it("reports zero reasoning at and below the threshold (output <= 10)", () => {
    expect(synthesizeThinkingTokens({ completion_tokens: 10 }).completion_tokens_details.reasoning_tokens).toBe(0);
    expect(synthesizeThinkingTokens({ completion_tokens: 9 }).completion_tokens_details.reasoning_tokens).toBe(0);
    expect(synthesizeThinkingTokens({ completion_tokens: 1 }).completion_tokens_details.reasoning_tokens).toBe(0);
  });

  it("leaves usage without a positive completion count untouched", () => {
    const zero = { completion_tokens: 0 };
    expect(synthesizeThinkingTokens(zero)).toBe(zero);
    const missing = { prompt_tokens: 5 };
    expect(synthesizeThinkingTokens(missing)).toBe(missing);
    const junk = { completion_tokens: "many" };
    expect(synthesizeThinkingTokens(junk)).toBe(junk);
    expect(synthesizeThinkingTokens(null)).toBe(null);
  });

  it("leaves usage that already reports reasoning tokens untouched", () => {
    const topLevel = { completion_tokens: 100, reasoning_tokens: 42 };
    expect(synthesizeThinkingTokens(topLevel)).toBe(topLevel);

    const nested = { completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 42 } };
    expect(synthesizeThinkingTokens(nested)).toBe(nested);
  });

  it("replaces the nested details without mutating the input object", () => {
    const nested = { cached_tokens: 3 };
    const usage = { prompt_tokens: 10, completion_tokens: 100, completion_tokens_details: nested };

    const result = synthesizeThinkingTokens(usage);

    // the stats side keeps holding the original object, unmodified
    expect(usage.completion_tokens_details).toBe(nested);
    expect(usage.completion_tokens_details.reasoning_tokens).toBeUndefined();
    // the client copy carries the synthesized field plus the original keys
    expect(result).not.toBe(usage);
    expect(result.completion_tokens_details).not.toBe(nested);
    expect(result.completion_tokens_details).toEqual({ cached_tokens: 3, reasoning_tokens: 70 });
  });
});

// End-to-end through the passthrough stream: the usage chunk the client sees
// gains the synthesized field while onStreamComplete (stats) receives the raw
// numbers — for every model, and for both finish-chunk shapes (upstream usage
// present on the finish chunk, or arriving early so the finish chunk is estimated).
describe("passthrough stream synthesis", () => {
  let createPassthroughStreamWithLogger;

  beforeAll(async () => {
    ({ createPassthroughStreamWithLogger } = await import("../../open-sse/utils/stream.js"));
  });

  async function runPassthrough(sseText, { provider, model } = { provider: "opencode", model: "big-pickle" }) {
    const chunks = [];
    const onStreamComplete = vi.fn();
    const stream = createPassthroughStreamWithLogger(provider, null, model, "conn-test", {}, onStreamComplete, null);
    const reader = stream.readable.getReader();
    const writer = stream.writable.getWriter();
    const done = (async () => {
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        chunks.push(new TextDecoder().decode(value));
      }
    })();
    await writer.write(new TextEncoder().encode(sseText));
    await writer.close();
    await done;
    return { output: chunks.join(""), onStreamComplete };
  }

  function parseChunks(output) {
    return output.split("\n")
      .map((l) => l.replace(/^data: ?/, ""))
      .filter((l) => l.startsWith("{"))
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  }

  it("synthesizes reasoning on the finish chunk when upstream usage arrives there", async () => {
    const upstream = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"hello world"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":100,"total_tokens":110}}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    const { output, onStreamComplete } = await runPassthrough(upstream);

    // client chunk: synthesized 70% of 100, prompt keeps the +2000 buffer
    const finishChunk = parseChunks(output).find((p) => p?.choices?.[0]?.finish_reason === "stop");
    expect(finishChunk.usage.completion_tokens_details.reasoning_tokens).toBe(70);
    expect(finishChunk.usage.completion_tokens).toBe(100);

    // stats side: raw upstream numbers, no synthesized reasoning anywhere
    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    const statsUsage = onStreamComplete.mock.calls[0][1];
    expect(statsUsage.completion_tokens).toBe(100);
    expect(statsUsage.prompt_tokens).toBe(10); // no +2000 client buffer
    expect(statsUsage.reasoning_tokens).toBeUndefined();
    expect(statsUsage.completion_tokens_details?.reasoning_tokens).toBeUndefined();
  });

  it("synthesizes reasoning on the estimated finish chunk when upstream usage arrives early (big-pickle shape)", async () => {
    // opencode big-pickle sends real usage BEFORE finish_reason; the finish
    // chunk itself carries none, so the client gets estimated usage.
    const upstream = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Seventeen times twenty-three equals three hundred ninety-one, because 17 multiplied by 23 gives 391."},"finish_reason":null}],"usage":{"prompt_tokens":10,"completion_tokens":34,"total_tokens":44}}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    const { output, onStreamComplete } = await runPassthrough(upstream);

    const finishChunk = parseChunks(output).find((p) => p?.choices?.[0]?.finish_reason === "stop");
    expect(finishChunk.usage.estimated).toBe(true);
    expect(finishChunk.usage.completion_tokens_details.reasoning_tokens).toBeGreaterThan(0);

    // stats side: the estimate, still without any reasoning field
    const statsUsage = onStreamComplete.mock.calls[0][1];
    expect(statsUsage.estimated).toBe(true);
    expect(statsUsage.completion_tokens_details?.reasoning_tokens).toBeUndefined();
    expect(statsUsage.reasoning_tokens).toBeUndefined();
  });

  it("synthesizes for every model, not just flagged ones", async () => {
    const upstream = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":100,"total_tokens":110}}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    for (const provider of ["openai", "anthropic", "some-new-provider"]) {
      const { output } = await runPassthrough(upstream, { provider, model: "any-model" });
      const finishChunk = parseChunks(output).find((p) => p?.choices?.[0]?.finish_reason === "stop");
      expect(finishChunk.usage.completion_tokens_details.reasoning_tokens, provider).toBe(70);
    }
  });

  it("keeps upstream-reported reasoning instead of synthesizing (muse-spark shape)", async () => {
    const upstream = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":100,"total_tokens":110,"completion_tokens_details":{"reasoning_tokens":42}}}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    const { output } = await runPassthrough(upstream, { provider: "opencode", model: "muse-spark-1.3-contributor-free" });
    const finishChunk = parseChunks(output).find((p) => p?.choices?.[0]?.finish_reason === "stop");
    expect(finishChunk.usage.completion_tokens_details.reasoning_tokens).toBe(42);
  });
});
