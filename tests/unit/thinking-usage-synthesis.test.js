// Hidden-thinking synthesis: streams whose upstream never reports
// reasoning_tokens get the field synthesized into the CLIENT-facing usage
// chunk — but only when the request asked for thinking (gate), at 75% of the
// output tokens. Real accumulated usage beats the chars/4 estimate; the usage
// kept for stats/logging stays raw.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";

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

  it("attributes 75% of completion tokens when output exceeds the threshold", () => {
    const result = synthesizeThinkingTokens({ prompt_tokens: 10, completion_tokens: 100, total_tokens: 110 });
    expect(result.completion_tokens_details.reasoning_tokens).toBe(75);
    // other fields pass through unchanged
    expect(result.prompt_tokens).toBe(10);
    expect(result.completion_tokens).toBe(100);
    expect(result.total_tokens).toBe(110);
  });

  it("floors the synthesized value", () => {
    // floor(11 * 0.75) = floor(8.25)
    expect(synthesizeThinkingTokens({ completion_tokens: 11 }).completion_tokens_details.reasoning_tokens).toBe(8);
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

  it("leaves usage that already reports reasoning tokens untouched, in any field shape", () => {
    const topLevel = { completion_tokens: 100, reasoning_tokens: 42 };
    expect(synthesizeThinkingTokens(topLevel)).toBe(topLevel);

    const nested = { completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 42 } };
    expect(synthesizeThinkingTokens(nested)).toBe(nested);

    const responses = { output_tokens: 100, output_tokens_details: { reasoning_tokens: 42 } };
    expect(synthesizeThinkingTokens(responses, FORMATS.OPENAI_RESPONSES)).toBe(responses);

    const gemini = { candidatesTokenCount: 100, thoughtsTokenCount: 42 };
    expect(synthesizeThinkingTokens(gemini, FORMATS.GEMINI)).toBe(gemini);
  });

  it("emits the reasoning field the target wire format carries", () => {
    // OpenAI chat (default): nested completion_tokens_details
    expect(synthesizeThinkingTokens({ completion_tokens: 100 }).completion_tokens_details.reasoning_tokens).toBe(75);
    // OpenAI Responses: nested output_tokens_details
    const responses = synthesizeThinkingTokens({ input_tokens: 10, output_tokens: 100 }, FORMATS.OPENAI_RESPONSES);
    expect(responses.output_tokens_details.reasoning_tokens).toBe(75);
    // Gemini: top-level thoughtsTokenCount, completion read from candidatesTokenCount
    const gemini = synthesizeThinkingTokens({ promptTokenCount: 10, candidatesTokenCount: 100 }, FORMATS.GEMINI);
    expect(gemini.thoughtsTokenCount).toBe(75);
    // Claude: no reasoning field exists on that wire format — no-op
    const claude = { input_tokens: 10, output_tokens: 100 };
    expect(synthesizeThinkingTokens(claude, FORMATS.CLAUDE)).toBe(claude);
  });

  it("reads completion from Claude/Gemini field names too", () => {
    expect(synthesizeThinkingTokens({ output_tokens: 100 }, FORMATS.OPENAI_RESPONSES).output_tokens_details.reasoning_tokens).toBe(75);
    expect(synthesizeThinkingTokens({ candidatesTokenCount: 100 }, FORMATS.GEMINI).thoughtsTokenCount).toBe(75);
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
    expect(result.completion_tokens_details).toEqual({ cached_tokens: 3, reasoning_tokens: 75 });
  });
});

describe("convertUsageForFormat", () => {
  let convertUsageForFormat;

  beforeAll(async () => {
    ({ convertUsageForFormat } = await import("../../open-sse/utils/usageTracking.js"));
  });

  it("renames canonical fields to Gemini usageMetadata names, keeping cache + reasoning", () => {
    const converted = convertUsageForFormat(
      { prompt_tokens: 10, completion_tokens: 100, total_tokens: 110, cached_tokens: 4, reasoning_tokens: 42, estimated: true },
      FORMATS.GEMINI_CLI
    );
    expect(converted).toEqual({
      promptTokenCount: 10,
      candidatesTokenCount: 100,
      totalTokenCount: 110,
      cachedContentTokenCount: 4,
      thoughtsTokenCount: 42,
      estimated: true,
    });
  });

  it("renames canonical fields to Responses usage names, keeping cache + reasoning", () => {
    const converted = convertUsageForFormat(
      { prompt_tokens: 10, completion_tokens: 100, cached_tokens: 4, reasoning_tokens: 42 },
      FORMATS.OPENAI_RESPONSES
    );
    expect(converted).toEqual({
      input_tokens: 10,
      output_tokens: 100,
      input_tokens_details: { cached_tokens: 4 },
      output_tokens_details: { reasoning_tokens: 42 },
    });
  });

  it("is identity for formats that share the canonical field names", () => {
    const usage = { prompt_tokens: 10, completion_tokens: 100 };
    expect(convertUsageForFormat(usage, FORMATS.OPENAI)).toBe(usage);
    expect(convertUsageForFormat(usage, FORMATS.CLAUDE)).toBe(usage);
  });
});

// End-to-end through the passthrough stream: synthesis only fires when the
// request asked for thinking, and the usage chunk the client sees gains the
// synthesized field while onStreamComplete (stats) receives the raw numbers.
describe("passthrough stream synthesis", () => {
  let createPassthroughStreamWithLogger;

  beforeAll(async () => {
    ({ createPassthroughStreamWithLogger } = await import("../../open-sse/utils/stream.js"));
  });

  const THINKING_BODY = { reasoning_effort: "medium" };

  async function runPassthrough(sseText, { provider = "opencode", model = "big-pickle", body = THINKING_BODY } = {}) {
    const chunks = [];
    const onStreamComplete = vi.fn();
    const stream = createPassthroughStreamWithLogger(provider, null, model, "conn-test", body, onStreamComplete, null);
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

  function finishChunkOf(output) {
    return parseChunks(output).find((p) => p?.choices?.[0]?.finish_reason === "stop");
  }

  it("synthesizes 75% on the finish chunk when the request asked for thinking", async () => {
    const upstream = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"hello world"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":100,"total_tokens":110}}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    const { output, onStreamComplete } = await runPassthrough(upstream);

    // client chunk: synthesized 75% of 100, prompt keeps the +2000 buffer
    const finishChunk = finishChunkOf(output);
    expect(finishChunk.usage.completion_tokens_details.reasoning_tokens).toBe(75);
    expect(finishChunk.usage.completion_tokens).toBe(100);
    expect(finishChunk.usage.prompt_tokens).toBe(2010);

    // stats side: raw upstream numbers, no synthesized reasoning anywhere
    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    const statsUsage = onStreamComplete.mock.calls[0][1];
    expect(statsUsage.completion_tokens).toBe(100);
    expect(statsUsage.prompt_tokens).toBe(10); // no +2000 client buffer
    expect(statsUsage.reasoning_tokens).toBeUndefined();
    expect(statsUsage.completion_tokens_details?.reasoning_tokens).toBeUndefined();
  });

  it("does NOT synthesize when the request has no thinking config", async () => {
    const upstream = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":100,"total_tokens":110}}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    const { output } = await runPassthrough(upstream, { body: {} });

    const finishChunk = finishChunkOf(output);
    expect(finishChunk.usage.completion_tokens).toBe(100);
    expect(finishChunk.usage.completion_tokens_details).toBeUndefined();
    expect(finishChunk.usage.reasoning_tokens).toBeUndefined();
  });

  it("does NOT synthesize when thinking is explicitly disabled", async () => {
    const upstream = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":100,"total_tokens":110}}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    const { output } = await runPassthrough(upstream, { body: { reasoning_effort: "none" } });

    const finishChunk = finishChunkOf(output);
    expect(finishChunk.usage.completion_tokens_details).toBeUndefined();
  });

  it("synthesizes when thinking is requested via the model suffix", async () => {
    const upstream = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":100,"total_tokens":110}}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    const { output } = await runPassthrough(upstream, { model: "big-pickle(high)", body: {} });

    expect(finishChunkOf(output).usage.completion_tokens_details.reasoning_tokens).toBe(75);
  });

  it("forwards the REAL early-arriving usage instead of estimating (big-pickle shape)", async () => {
    // opencode big-pickle sends real usage BEFORE finish_reason; the finish
    // chunk itself carries none. The client must get the real numbers, not a
    // chars/4 estimate.
    const upstream = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Seventeen times twenty-three equals three hundred ninety-one, because 17 multiplied by 23 gives 391."},"finish_reason":null}],"usage":{"prompt_tokens":10,"completion_tokens":34,"total_tokens":44}}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    const { output, onStreamComplete } = await runPassthrough(upstream);

    const finishChunk = finishChunkOf(output);
    expect(finishChunk.usage.estimated).toBeUndefined();
    expect(finishChunk.usage.completion_tokens).toBe(34);
    // floor(34 * 0.75) = floor(25.5)
    expect(finishChunk.usage.completion_tokens_details.reasoning_tokens).toBe(25);

    // stats side: the real numbers survive — no estimate overwrote them
    const statsUsage = onStreamComplete.mock.calls[0][1];
    expect(statsUsage.estimated).toBeUndefined();
    expect(statsUsage.completion_tokens).toBe(34);
    expect(statsUsage.reasoning_tokens).toBeUndefined();
  });

  it("falls back to estimated usage only when no real usage was ever seen", async () => {
    const upstream = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"' + "x".repeat(100) + '"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    const { output } = await runPassthrough(upstream);

    const finishChunk = finishChunkOf(output);
    expect(finishChunk.usage.estimated).toBe(true);
    expect(finishChunk.usage.completion_tokens).toBe(25); // floor(100 chars / 4)
    expect(finishChunk.usage.completion_tokens_details.reasoning_tokens).toBe(18); // floor(25 * 0.75)
  });

  it("keeps upstream-reported reasoning instead of synthesizing (muse-spark shape)", async () => {
    const upstream = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":100,"total_tokens":110,"completion_tokens_details":{"reasoning_tokens":42}}}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    const { output } = await runPassthrough(upstream, { model: "muse-spark-1.3-contributor-free" });
    expect(finishChunkOf(output).usage.completion_tokens_details.reasoning_tokens).toBe(42);
  });
});
