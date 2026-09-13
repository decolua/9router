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
    // Claude Messages wire has no native field — top-level reasoning_tokens
    // annotation (thinking is already inside output_tokens upstream)
    const claude = synthesizeThinkingTokens({ input_tokens: 10, output_tokens: 100 }, FORMATS.CLAUDE);
    expect(claude.reasoning_tokens).toBe(75);
    expect(claude.output_tokens).toBe(100);
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

  it("honors an explicit ratio across every wire-format family", () => {
    expect(synthesizeThinkingTokens({ completion_tokens: 100 }, FORMATS.OPENAI, 0.5).completion_tokens_details.reasoning_tokens).toBe(50);
    expect(synthesizeThinkingTokens({ output_tokens: 100 }, FORMATS.OPENAI_RESPONSES, 0.5).output_tokens_details.reasoning_tokens).toBe(50);
    expect(synthesizeThinkingTokens({ candidatesTokenCount: 100 }, FORMATS.GEMINI, 0.5).thoughtsTokenCount).toBe(50);
    expect(synthesizeThinkingTokens({ output_tokens: 100 }, FORMATS.CLAUDE, 0.5).reasoning_tokens).toBe(50);
  });

  it("falls back to the default ratio for junk ratio input", () => {
    expect(synthesizeThinkingTokens({ completion_tokens: 100 }, FORMATS.OPENAI, "abc").completion_tokens_details.reasoning_tokens).toBe(75);
    expect(synthesizeThinkingTokens({ completion_tokens: 100 }, FORMATS.OPENAI, NaN).completion_tokens_details.reasoning_tokens).toBe(75);
  });

  it("keeps the threshold and reported-passthrough rules under an explicit ratio", () => {
    // completion <= 10 still reports 0 regardless of the ratio
    expect(synthesizeThinkingTokens({ completion_tokens: 10 }, FORMATS.OPENAI, 1).completion_tokens_details.reasoning_tokens).toBe(0);
    // upstream-reported reasoning is still never overridden
    const reported = { completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 42 } };
    expect(synthesizeThinkingTokens(reported, FORMATS.OPENAI, 1)).toBe(reported);
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

    // client chunk: the chunk's own real numbers stay untouched, only the
    // synthesized reasoning field is added
    const finishChunk = finishChunkOf(output);
    expect(finishChunk.usage.completion_tokens_details.reasoning_tokens).toBe(75);
    expect(finishChunk.usage.completion_tokens).toBe(100);
    expect(finishChunk.usage.prompt_tokens).toBe(10);

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

  it("rewrites the TRAILING usage chunk (after finish) instead of forwarding it raw", async () => {
    // stream_options.include_usage shape: usage arrives in its own chunk with
    // empty choices AFTER the finish chunk. Clients that read the LAST
    // usage-bearing chunk previously saw the raw numbers — no synthesized
    // reasoning, no +2000 buffer.
    const upstream = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"hello world"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":100,"total_tokens":110}}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    const { output, onStreamComplete } = await runPassthrough(upstream);

    const withUsage = parseChunks(output).filter((p) => p.usage);
    expect(withUsage.length).toBeGreaterThan(0);
    const last = withUsage[withUsage.length - 1];
    expect(last.usage.completion_tokens_details.reasoning_tokens).toBe(75);
    expect(last.usage.prompt_tokens).toBe(10);

    // stats: the real numbers replace the estimate injected on the finish chunk
    const statsUsage = onStreamComplete.mock.calls[0][1];
    expect(statsUsage.prompt_tokens).toBe(10);
    expect(statsUsage.completion_tokens).toBe(100);
    expect(statsUsage.estimated).toBeUndefined();
  });
});

// The FULL combo pipeline a streamed response traverses in production:
// seam (passthrough stream) → stripSystemPromptFromResponse (needle redaction,
// holds terminal lines back until flush) → rewriteResponseModelName. The
// wrappers must not lose or reorder-away the synthesized reasoning field.
describe("combo pipeline (strip + model rewrite)", () => {
  let createPassthroughStreamWithLogger, stripSystemPromptFromResponse, rewriteResponseModelName;

  beforeAll(async () => {
    ({ createPassthroughStreamWithLogger } = await import("../../open-sse/utils/stream.js"));
    ({ stripSystemPromptFromResponse } = await import("../../open-sse/utils/systemPromptStrip.js"));
    ({ rewriteResponseModelName } = await import("../../open-sse/utils/modelNameRewrite.js"));
  });

  const THINKING_BODY = { reasoning_effort: "high" };
  const COMBO_PROMPT = "You are Servo, a helpful assistant created by Acme Corp.";

  async function runComboPipeline(sseText) {
    const stream = createPassthroughStreamWithLogger("opencode", null, "big-pickle", "conn-test", THINKING_BODY, null, null);
    const reader = stream.readable.getReader();
    const writer = stream.writable.getWriter();
    const collected = [];
    const done = (async () => {
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        collected.push(value);
      }
    })();
    await writer.write(new TextEncoder().encode(sseText));
    await writer.close();
    await done;

    const seamResponse = new Response(new Blob(collected), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    const stripped = await stripSystemPromptFromResponse(seamResponse, COMBO_PROMPT);
    const rewritten = await rewriteResponseModelName(stripped, "deepseek-v4-flash-0731", true);
    const text = await rewritten.text();
    return text;
  }

  function lastUsageOf(output) {
    const lines = output.split("\n").filter((l) => l.startsWith("data: ") && l.includes('"usage"'));
    expect(lines.length).toBeGreaterThan(0);
    return JSON.parse(lines[lines.length - 1].slice(6));
  }

  it("keeps synthesized reasoning on the LAST usage chunk through the whole pipeline (trailing usage shape)", async () => {
    const upstream = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"big-pickle","choices":[{"index":0,"delta":{"content":"Servo says: the answer is forty-two."},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"big-pickle","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"big-pickle","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":100,"total_tokens":110}}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    const output = await runComboPipeline(upstream);
    const last = lastUsageOf(output);
    expect(last.usage.completion_tokens_details.reasoning_tokens).toBe(75);
    expect(last.model).toBe("deepseek-v4-flash-0731"); // combo name reported
  });

  it("keeps synthesized reasoning when usage rides on content chunks (early usage shape)", async () => {
    const upstream = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"big-pickle","choices":[{"index":0,"delta":{"content":"a reasonably long answer over the ten token threshold"},"finish_reason":null}],"usage":{"prompt_tokens":10,"completion_tokens":100,"total_tokens":110}}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"big-pickle","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    const output = await runComboPipeline(upstream);
    const last = lastUsageOf(output);
    expect(last.usage.completion_tokens_details.reasoning_tokens).toBe(75);
  });
});
// The real path for a generic OpenAI Completions client routed to an
// OpenAI-compatible provider when formats differ at the seam: TRANSLATE mode.
// Same-format routes return chunks untranslated (translateResponse
// short-circuits), so no translator ever sets state.finishReason — the seam
// must key on the item's own shape or it is dead code there.
describe("translate stream synthesis (same-format openai→openai)", () => {
  let createSSETransformStreamWithLogger;

  beforeAll(async () => {
    ({ createSSETransformStreamWithLogger } = await import("../../open-sse/utils/stream.js"));
  });

  const THINKING_BODY = { reasoning_effort: "high" };

  async function runTranslate(sseText) {
    const chunks = [];
    const onStreamComplete = vi.fn();
    const stream = createSSETransformStreamWithLogger(
      FORMATS.OPENAI, FORMATS.OPENAI, "opencode", null, null, "big-pickle", "conn-test", THINKING_BODY, onStreamComplete, null
    );
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

  it("synthesizes on the finish chunk carrying usage (usage embedded)", async () => {
    const upstream = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"hello world"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":100,"total_tokens":110}}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    const { output, onStreamComplete } = await runTranslate(upstream);

    const finish = parseChunks(output).find((p) => p?.choices?.[0]?.finish_reason === "stop");
    expect(finish.usage.completion_tokens_details.reasoning_tokens).toBe(75);
    expect(finish.usage.completion_tokens).toBe(100);
    expect(finish.usage.prompt_tokens).toBe(10); // real numbers untouched, only the field added

    const statsUsage = onStreamComplete.mock.calls[0][1];
    expect(statsUsage.prompt_tokens).toBe(10);
    expect(statsUsage.completion_tokens).toBe(100);
    expect(statsUsage.reasoning_tokens).toBeUndefined();
  });

  it("rewrites the trailing usage chunk (after finish) instead of forwarding it raw", async () => {
    const upstream = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"a longer answer well above the synthesis threshold"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":100,"total_tokens":110}}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    const { output, onStreamComplete } = await runTranslate(upstream);

    const withUsage = parseChunks(output).filter((p) => p.usage);
    expect(withUsage.length).toBeGreaterThan(0);
    const last = withUsage[withUsage.length - 1];
    expect(last.usage.completion_tokens_details.reasoning_tokens).toBe(75);
    expect(last.usage.prompt_tokens).toBe(10);
    expect(last.usage.completion_tokens).toBe(100);

    // stats: real numbers — the finish-chunk estimate must be REPLACED, not
    // max-merged (which kept the inflated chars/4 prompt)
    const statsUsage = onStreamComplete.mock.calls[0][1];
    expect(statsUsage.prompt_tokens).toBe(10);
    expect(statsUsage.completion_tokens).toBe(100);
    expect(statsUsage.estimated).toBeUndefined();
  });

  it("estimates when the upstream never sends usage", async () => {
    const upstream = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"' + "x".repeat(100) + '"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    const { output } = await runTranslate(upstream);

    const finish = parseChunks(output).find((p) => p?.choices?.[0]?.finish_reason === "stop");
    expect(finish.usage.estimated).toBe(true);
    expect(finish.usage.completion_tokens).toBe(25); // floor(100 chars / 4)
    expect(finish.usage.completion_tokens_details.reasoning_tokens).toBe(18); // floor(25 * 0.75)
  });

  it("does NOT synthesize without thinking config (same-format translate)", async () => {
    const chunks = [];
    const onStreamComplete = vi.fn();
    const stream = createSSETransformStreamWithLogger(
      FORMATS.OPENAI, FORMATS.OPENAI, "opencode", null, null, "big-pickle", "conn-test", {}, onStreamComplete, null
    );
    const reader = stream.readable.getReader();
    const writer = stream.writable.getWriter();
    const done = (async () => {
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        chunks.push(new TextDecoder().decode(value));
      }
    })();
    const upstream = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":100,"total_tokens":110}}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    await writer.write(new TextEncoder().encode(upstream));
    await writer.close();
    await done;

    const finish = parseChunks(chunks.join("")).find((p) => p?.choices?.[0]?.finish_reason === "stop");
    expect(finish.usage.completion_tokens_details).toBeUndefined();
    expect(finish.usage.prompt_tokens).toBe(10); // upstream numbers untouched
  });
});

// Production repro: the client body passes through translateRequest BY
// REFERENCE before the stream seam is built, and translation strips thinking
// config in place — applyThinking's stripAll for models whose capabilities say
// reasoning:false (big-pickle is not in the capabilities registry), and
// normalizeThinkingConfig for non-user last messages. chatCore therefore
// snapshots the intent pre-translation and hands it to the seam as
// `thinkingIntent`; without it the gate reads a body that has already lost
// the very field it gates on and synthesis never fires.
describe("intent captured before translateRequest (production shape)", () => {
  let createPassthroughStreamWithLogger, translateRequest, extractThinking;

  beforeAll(async () => {
    ({ createPassthroughStreamWithLogger } = await import("../../open-sse/utils/stream.js"));
    ({ translateRequest } = await import("../../open-sse/translator/index.js"));
    ({ extractThinking } = await import("../../open-sse/translator/concerns/thinkingUnified.js"));
  });

  const UPSTREAM = [
    'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"hello world"},"finish_reason":null}]}',
    'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":100,"total_tokens":110}}',
    "data: [DONE]",
    "",
  ].join("\n\n");

  async function runStream(body, thinkingIntent) {
    const chunks = [];
    const stream = createPassthroughStreamWithLogger("opencode", null, "big-pickle", "conn-test", body, null, null, thinkingIntent);
    const reader = stream.readable.getReader();
    const writer = stream.writable.getWriter();
    const done = (async () => {
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        chunks.push(new TextDecoder().decode(value));
      }
    })();
    await writer.write(new TextEncoder().encode(UPSTREAM));
    await writer.close();
    await done;
    return chunks.join("");
  }

  function finishUsageOf(output) {
    const parsed = output.split("\n")
      .map((l) => l.replace(/^data: ?/, ""))
      .filter((l) => l.startsWith("{"))
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
    return parsed.find((p) => p?.choices?.[0]?.finish_reason === "stop")?.usage;
  }

  it("still synthesizes when translateRequest has stripped the thinking config from the body", async () => {
    const body = { model: "big-pickle", messages: [{ role: "user", content: "hi" }], stream: true, reasoning_effort: "high" };

    // what chatCore does: snapshot intent, then translate (mutates body in place)
    const intent = extractThinking(body);
    expect(intent).toEqual({ mode: "level", level: "high" });
    translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "big-pickle", body, true, null, "opencode");
    // the strip the gate used to trip over: caps say big-pickle cannot reason
    expect(body.reasoning_effort).toBeUndefined();

    const usage = finishUsageOf(await runStream(body, intent));
    expect(usage.completion_tokens_details.reasoning_tokens).toBe(75);
    expect(usage.completion_tokens).toBe(100); // real numbers untouched
  });

  it("does NOT synthesize from a stripped body when no intent is passed (the old, broken gate)", async () => {
    const body = { model: "big-pickle", messages: [{ role: "user", content: "hi" }], stream: true, reasoning_effort: "high" };
    translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "big-pickle", body, true, null, "opencode");
    expect(body.reasoning_effort).toBeUndefined();

    const usage = finishUsageOf(await runStream(body, null));
    expect(usage.completion_tokens_details).toBeUndefined();
  });

  it("an explicit none intent disables synthesis even though the body lost the field", async () => {
    const body = { model: "big-pickle", messages: [{ role: "user", content: "hi" }], stream: true, reasoning_effort: "none" };
    const intent = extractThinking(body);
    translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "big-pickle", body, true, null, "opencode");

    const usage = finishUsageOf(await runStream(body, intent));
    expect(usage.completion_tokens_details).toBeUndefined();
  });
});

// Messages API (Claude wire) clients: the stream seam synthesizes a top-level
// reasoning_tokens annotation because the Anthropic usage object has no native
// thinking field (thinking is folded into output_tokens).
describe("claude messages stream synthesis", () => {
  let createPassthroughStreamWithLogger;

  beforeAll(async () => {
    ({ createPassthroughStreamWithLogger } = await import("../../open-sse/utils/stream.js"));
  });

  const THINKING_BODY = { thinking: { type: "enabled", budget_tokens: 2000 } };

  const SSE = [
    'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":10,"output_tokens":1}}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"a reasonably long answer"}}',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":100}}',
    'data: {"type":"message_stop"}',
    "",
  ].join("\n\n");

  async function runClaudeStream(body = THINKING_BODY) {
    const chunks = [];
    const stream = createPassthroughStreamWithLogger("claude", null, "big-pickle", "conn-test", body, null, null, null, FORMATS.CLAUDE);
    const reader = stream.readable.getReader();
    const writer = stream.writable.getWriter();
    const done = (async () => {
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        chunks.push(new TextDecoder().decode(value));
      }
    })();
    await writer.write(new TextEncoder().encode(SSE));
    await writer.close();
    await done;
    return chunks.join("");
  }

  function deltaUsageOf(output) {
    const parsed = output.split("\n")
      .map((l) => l.replace(/^data: ?/, ""))
      .filter((l) => l.startsWith("{"))
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
    return parsed.find((p) => p?.type === "message_delta")?.usage;
  }

  it("annotates reasoning_tokens on the message_delta usage when thinking was requested", async () => {
    const usage = deltaUsageOf(await runClaudeStream());
    expect(usage.reasoning_tokens).toBe(75);
    expect(usage.output_tokens).toBe(100); // real numbers untouched
  });

  it("does NOT annotate when the request has no thinking config", async () => {
    const usage = deltaUsageOf(await runClaudeStream({}));
    expect(usage.reasoning_tokens).toBeUndefined();
  });
});

// Non-streaming (JSON) responses: the same synthesis rule applies to the
// client-facing usage of the translated body, whatever the client wire format.
describe("non-streaming JSON synthesis", () => {
  let handleNonStreamingResponse, extractThinking;

  beforeAll(async () => {
    ({ handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js"));
    ({ extractThinking } = await import("../../open-sse/translator/concerns/thinkingUnified.js"));
  });

  const OPENAI_COMPLETION = {
    id: "chatcmpl-1", object: "chat.completion", created: 1, model: "big-pickle",
    choices: [{ index: 0, message: { role: "assistant", content: "a reasonably long answer" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 100, total_tokens: 110 },
  };
  const CLAUDE_MESSAGE = {
    id: "msg_1", type: "message", role: "assistant", model: "big-pickle",
    content: [{ type: "text", text: "a reasonably long answer" }],
    stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 100 },
  };

  async function runJson(providerBody, sourceFormat, body, thinkingIntent, thinkingSynthesis) {
    const providerResponse = new Response(JSON.stringify(providerBody), {
      status: 200, headers: { "content-type": "application/json" },
    });
    const result = await handleNonStreamingResponse({
      providerResponse, provider: "opencode", model: "big-pickle",
      sourceFormat, targetFormat: sourceFormat,
      body, stream: false, translatedBody: providerBody, finalBody: null,
      requestStartTime: Date.now(), connectionId: "conn-test", apiKey: null,
      clientRawRequest: null, requestedModel: "oc/big-pickle",
      reqLogger: { logProviderResponse() {}, logConvertedResponse() {} },
      toolNameMap: null, customToolNames: null,
      trackDone: () => {}, appendLog: () => {}, reqTag: "", log: null,
      thinkingIntent, thinkingSynthesis,
    });
    return JSON.parse(await result.response.text());
  }

  it("completions JSON: synthesizes completion_tokens_details when thinking was requested", async () => {
    const out = await runJson(OPENAI_COMPLETION, FORMATS.OPENAI, {}, { mode: "level", level: "high" });
    expect(out.usage.completion_tokens_details.reasoning_tokens).toBe(75);
    expect(out.usage.completion_tokens).toBe(100);
  });

  it("messages JSON: annotates top-level reasoning_tokens when thinking was requested", async () => {
    const body = { thinking: { type: "enabled", budget_tokens: 2000 } };
    const out = await runJson(CLAUDE_MESSAGE, FORMATS.CLAUDE, body, extractThinking(body));
    expect(out.usage.reasoning_tokens).toBe(75);
    expect(out.usage.output_tokens).toBe(100);
  });

  it("does NOT synthesize without thinking intent", async () => {
    const out = await runJson(OPENAI_COMPLETION, FORMATS.OPENAI, {}, null);
    expect(out.usage.completion_tokens_details).toBeUndefined();
  });

  it("keeps upstream-reported reasoning untouched", async () => {
    const reported = { ...OPENAI_COMPLETION, usage: { prompt_tokens: 10, completion_tokens: 100, total_tokens: 110, completion_tokens_details: { reasoning_tokens: 42 } } };
    const out = await runJson(reported, FORMATS.OPENAI, {}, { mode: "level", level: "high" });
    expect(out.usage.completion_tokens_details.reasoning_tokens).toBe(42);
  });

  it("per-combo always + ratio: synthesizes even without any thinking intent", async () => {
    const out = await runJson(OPENAI_COMPLETION, FORMATS.OPENAI, {}, null, { enabled: true, ratio: 0.5 });
    expect(out.usage.completion_tokens_details.reasoning_tokens).toBe(50);
  });

  it("per-combo off: never synthesizes, even with a thinking body", async () => {
    const out = await runJson(OPENAI_COMPLETION, FORMATS.OPENAI, { reasoning_effort: "high" }, { mode: "level", level: "high" }, { enabled: false, ratio: undefined });
    expect(out.usage.completion_tokens_details).toBeUndefined();
  });
});

// Provider forced streaming but the client wants JSON: the SSE is consumed and
// re-assembled into one JSON body — the re-attached usage must carry the
// synthesized reasoning field too.
describe("forced SSE→JSON synthesis", () => {
  let handleForcedSSEToJson;

  beforeAll(async () => {
    ({ handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js"));
  });

  const SSE = [
    'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"a reasonably long answer"},"finish_reason":null}]}',
    'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":100,"total_tokens":110}}',
    "data: [DONE]",
    "",
  ].join("\n\n");

  async function runForced(sourceFormat, thinkingIntent, thinkingSynthesis) {
    const providerResponse = new Response(SSE, {
      status: 200, headers: { "content-type": "text/event-stream" },
    });
    const result = await handleForcedSSEToJson({
      providerResponse, sourceFormat, targetFormat: FORMATS.OPENAI,
      provider: "opencode", model: "big-pickle",
      body: {}, stream: false, translatedBody: {}, finalBody: null,
      requestStartTime: Date.now(), connectionId: "conn-test", apiKey: null,
      clientRawRequest: null, requestedModel: "oc/big-pickle", customToolNames: null,
      trackDone: () => {}, appendLog: () => {}, reqTag: "", log: null,
      thinkingIntent, thinkingSynthesis,
    });
    return JSON.parse(await result.response.text());
  }

  it("synthesizes reasoning on the re-assembled JSON usage", async () => {
    const out = await runForced(FORMATS.OPENAI, { mode: "level", level: "high" });
    expect(out.usage.completion_tokens_details.reasoning_tokens).toBe(75);
    expect(out.usage.prompt_tokens).toBe(10); // real numbers, no buffer on this path
  });

  it("does NOT synthesize without thinking intent", async () => {
    const out = await runForced(FORMATS.OPENAI, null);
    expect(out.usage.completion_tokens_details).toBeUndefined();
  });

  it("per-combo always + ratio: synthesizes without thinking intent at the drawn ratio", async () => {
    const out = await runForced(FORMATS.OPENAI, null, { enabled: true, ratio: 0.5 });
    expect(out.usage.completion_tokens_details.reasoning_tokens).toBe(50);
  });

  it("per-combo off: never synthesizes even with thinking intent", async () => {
    const out = await runForced(FORMATS.OPENAI, { mode: "level", level: "high" }, { enabled: false, ratio: undefined });
    expect(out.usage.completion_tokens_details).toBeUndefined();
  });
});

// Per-combo config resolution: mode off/always is an operator override that
// WINS over the model suffix / request intent; auto keeps the legacy gate.
// The ratio is drawn once, here — injected `random` makes the draw testable.
describe("resolveThinkingSynthesis (per-combo config)", () => {
  let resolveThinkingSynthesis;

  beforeAll(async () => {
    ({ resolveThinkingSynthesis } = await import("../../open-sse/utils/stream.js"));
  });

  const THINKING_BODY = { reasoning_effort: "high" };

  it("no combo config → legacy gate, ratio undefined (fixed 75%)", () => {
    expect(resolveThinkingSynthesis(THINKING_BODY, "big-pickle", null, null))
      .toEqual({ enabled: true, ratio: undefined });
    expect(resolveThinkingSynthesis({}, "big-pickle", null, null))
      .toEqual({ enabled: false, ratio: undefined });
    // explicit none still disables
    expect(resolveThinkingSynthesis({ reasoning_effort: "none" }, "big-pickle", null, null))
      .toEqual({ enabled: false, ratio: undefined });
    // model suffix counts as a request signal
    expect(resolveThinkingSynthesis({}, "big-pickle(high)", null, null))
      .toEqual({ enabled: true, ratio: undefined });
  });

  it("mode off disables synthesis even with thinking body AND model suffix", () => {
    const out = resolveThinkingSynthesis(THINKING_BODY, "big-pickle(high)", null, { mode: "off", minRatio: null, maxRatio: null });
    expect(out).toEqual({ enabled: false, ratio: undefined });
  });

  it("mode always enables synthesis even with no request signal and explicit none", () => {
    expect(resolveThinkingSynthesis({}, "big-pickle", null, { mode: "always", minRatio: null, maxRatio: null }).enabled).toBe(true);
    expect(resolveThinkingSynthesis({ reasoning_effort: "none" }, "big-pickle", { mode: "none" }, { mode: "always", minRatio: null, maxRatio: null }).enabled).toBe(true);
  });

  it("mode auto keeps the legacy gate but still draws the ratio", () => {
    const enabled = resolveThinkingSynthesis(THINKING_BODY, "big-pickle", null, { mode: "auto", minRatio: 0.2, maxRatio: 0.4 }, () => 0.5);
    expect(enabled.enabled).toBe(true);
    expect(enabled.ratio).toBeCloseTo(0.3, 10);
    const disabled = resolveThinkingSynthesis({}, "big-pickle", null, { mode: "auto", minRatio: 0.2, maxRatio: 0.4 });
    expect(disabled.enabled).toBe(false);
  });

  it("garbage config object degrades to legacy auto", () => {
    expect(resolveThinkingSynthesis(THINKING_BODY, "big-pickle", null, { mode: "junk" })).toEqual({ enabled: true, ratio: undefined });
    expect(resolveThinkingSynthesis({}, "big-pickle", null, 42)).toEqual({ enabled: false, ratio: undefined });
  });

  it("ratio draw: both bounds unset → undefined (no random call, fixed 75%)", () => {
    let called = 0;
    const out = resolveThinkingSynthesis(THINKING_BODY, "big-pickle", null, { mode: "always" }, () => { called++; return 0.9; });
    expect(out).toEqual({ enabled: true, ratio: undefined });
    expect(called).toBe(0);
  });

  it("ratio draw: explicit null bounds (real resolver shape) → default 75%, never 0", () => {
    // resolveComboThinkingUsage emits explicit nulls for unset ratios — and
    // Number(null) === 0, so a null guard must run BEFORE the numeric coercion
    // (regression: mode always + null bounds used to draw ratio 0 → reasoning 0).
    let called = 0;
    const random = () => { called++; return 0.9; };
    expect(resolveThinkingSynthesis(THINKING_BODY, "big-pickle", null, { mode: "always", minRatio: null, maxRatio: null }, random))
      .toEqual({ enabled: true, ratio: undefined });
    // One bound + explicit null other bound → fixed value, not a swapped [0, bound] range.
    expect(resolveThinkingSynthesis(THINKING_BODY, "big-pickle", null, { mode: "always", minRatio: 0.4, maxRatio: null }, random).ratio).toBe(0.4);
    expect(resolveThinkingSynthesis(THINKING_BODY, "big-pickle", null, { mode: "always", minRatio: null, maxRatio: 0.6 }, random).ratio).toBe(0.6);
    expect(called).toBe(0);
  });

  it("ratio draw: one bound set → fixed value, random never called", () => {
    let called = 0;
    const random = () => { called++; return 0.9; };
    expect(resolveThinkingSynthesis(THINKING_BODY, "big-pickle", null, { mode: "always", minRatio: 0.4 }, random).ratio).toBe(0.4);
    expect(resolveThinkingSynthesis(THINKING_BODY, "big-pickle", null, { mode: "always", maxRatio: 0.4 }, random).ratio).toBe(0.4);
    expect(called).toBe(0);
  });

  it("ratio draw: uniform in [min, max] at the random endpoints and midpoint", () => {
    const cfg = { mode: "always", minRatio: 0.2, maxRatio: 0.6 };
    expect(resolveThinkingSynthesis(THINKING_BODY, "big-pickle", null, cfg, () => 0).ratio).toBeCloseTo(0.2, 10);
    expect(resolveThinkingSynthesis(THINKING_BODY, "big-pickle", null, cfg, () => 1).ratio).toBeCloseTo(0.6, 10);
    expect(resolveThinkingSynthesis(THINKING_BODY, "big-pickle", null, cfg, () => 0.5).ratio).toBeCloseTo(0.4, 10);
  });

  it("ratio draw: min > max swapped, out-of-range clamped, junk ignored", () => {
    expect(resolveThinkingSynthesis(THINKING_BODY, "big-pickle", null, { mode: "always", minRatio: 0.8, maxRatio: 0.4 }, () => 0).ratio).toBeCloseTo(0.4, 10);
    expect(resolveThinkingSynthesis(THINKING_BODY, "big-pickle", null, { mode: "always", minRatio: -0.5, maxRatio: 1.5 }, () => 0.5).ratio).toBeCloseTo(0.5, 10);
    expect(resolveThinkingSynthesis(THINKING_BODY, "big-pickle", null, { mode: "always", minRatio: "low" }, () => 0.9).ratio).toBe(undefined);
  });
});

// The pre-resolved decision threads into both stream wrappers as the trailing
// argument; every synthesis site of ONE stream must report the SAME ratio.
describe("pre-resolved thinkingSynthesis through the stream wrappers", () => {
  let createPassthroughStreamWithLogger, createSSETransformStreamWithLogger;

  beforeAll(async () => {
    ({ createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } = await import("../../open-sse/utils/stream.js"));
  });

  // Real usage rides BOTH the finish chunk and a trailing usage chunk, so the
  // two synthesis sites see identical numbers — the assertion is that every
  // site reports the SAME drawn ratio (an estimate-seam chunk would
  // legitimately differ; that path is covered by the legacy tests above).
  const UPSTREAM = [
    'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"hello world"},"finish_reason":null}]}',
    'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":100,"total_tokens":110}}',
    'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":100,"total_tokens":110}}',
    "data: [DONE]",
    "",
  ].join("\n\n");

  async function runStream(streamFactory) {
    const chunks = [];
    const onStreamComplete = vi.fn();
    const stream = streamFactory(onStreamComplete);
    const reader = stream.readable.getReader();
    const writer = stream.writable.getWriter();
    const done = (async () => {
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        chunks.push(new TextDecoder().decode(value));
      }
    })();
    await writer.write(new TextEncoder().encode(UPSTREAM));
    await writer.close();
    await done;
    const parsed = chunks.join("").split("\n")
      .map((l) => l.replace(/^data: ?/, ""))
      .filter((l) => l.startsWith("{"))
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
    const withUsage = parsed.filter((p) => p.usage);
    return { withUsage, onStreamComplete };
  }

  it("always + ratio 0.5 synthesizes the SAME count on finish and trailing usage chunks (passthrough)", async () => {
    const { withUsage, onStreamComplete } = await runStream((onComplete) =>
      createPassthroughStreamWithLogger("opencode", null, "big-pickle", "conn-test", {}, onComplete, null, null, null, { enabled: true, ratio: 0.5 })
    );
    expect(withUsage.length).toBe(2);
    for (const chunk of withUsage) {
      expect(chunk.usage.completion_tokens_details.reasoning_tokens).toBe(50);
    }
    // stats stay raw
    const statsUsage = onStreamComplete.mock.calls[0][1];
    expect(statsUsage.reasoning_tokens).toBeUndefined();
    expect(statsUsage.completion_tokens_details?.reasoning_tokens).toBeUndefined();
  });

  it("off disables synthesis even with a thinking body (translate wrapper)", async () => {
    const { withUsage } = await runStream((onComplete) =>
      createSSETransformStreamWithLogger(FORMATS.OPENAI, FORMATS.OPENAI, "opencode", null, null, "big-pickle", "conn-test", { reasoning_effort: "high" }, onComplete, null, null, null, null, { enabled: false, ratio: undefined })
    );
    expect(withUsage.length).toBeGreaterThan(0);
    for (const chunk of withUsage) {
      expect(chunk.usage.completion_tokens_details).toBeUndefined();
    }
  });

  it("absent thinkingSynthesis keeps the legacy gate (backward compat)", async () => {
    const legacyOn = await runStream((onComplete) =>
      createPassthroughStreamWithLogger("opencode", null, "big-pickle", "conn-test", { reasoning_effort: "high" }, onComplete, null)
    );
    expect(legacyOn.withUsage[legacyOn.withUsage.length - 1].usage.completion_tokens_details.reasoning_tokens).toBe(75);

    const legacyOff = await runStream((onComplete) =>
      createPassthroughStreamWithLogger("opencode", null, "big-pickle", "conn-test", {}, onComplete, null)
    );
    expect(legacyOff.withUsage[legacyOff.withUsage.length - 1].usage.completion_tokens_details).toBeUndefined();
  });
});

// The app-side config surfaces: sanitizer/repo roundtrip, resolver semantics
// (explicit-only, media guard) and export/import carrying the new fields.
describe("combo thinking-usage config (DB + resolver)", () => {
  let createCombo, updateCombo, getComboByName, deleteCombo, exportDb, importDb;
  let sanitizeComboThinkingUsageFields, resolveComboThinkingUsage;
  let seq = 0;
  const nextName = () => `tu-combo-${Date.now()}-${seq++}`;

  beforeAll(async () => {
    ({ createCombo, updateCombo, getComboByName, deleteCombo, exportDb, importDb, sanitizeComboThinkingUsageFields } = await import("@/lib/db/index.js"));
    ({ resolveComboThinkingUsage } = await import("@/sse/services/model.js"));
  });

  it("sanitizer: valid values pass, junk clears to null, absent keys omitted", () => {
    expect(sanitizeComboThinkingUsageFields({ thinkingUsageMode: "always", thinkingUsageMinRatio: 0.2, thinkingUsageMaxRatio: 0.8 }))
      .toEqual({ thinkingUsageMode: "always", thinkingUsageMinRatio: 0.2, thinkingUsageMaxRatio: 0.8 });
    expect(sanitizeComboThinkingUsageFields({ thinkingUsageMode: "bogus", thinkingUsageMinRatio: 5, thinkingUsageMaxRatio: "high" }))
      .toEqual({ thinkingUsageMode: null, thinkingUsageMinRatio: 1, thinkingUsageMaxRatio: null });
    // clamped, not rejected
    expect(sanitizeComboThinkingUsageFields({ thinkingUsageMinRatio: -0.5 })).toEqual({ thinkingUsageMinRatio: 0 });
    // absent keys stay omitted → merge keeps stored values
    expect(sanitizeComboThinkingUsageFields({ name: "x" })).toEqual({});
    expect(sanitizeComboThinkingUsageFields(null)).toEqual({});
  });

  it("resolver: default combo → null; explicit mode/ratios → exact object; media combo → null", async () => {
    const name = nextName();
    const created = await createCombo({ name, models: ["oc/big-pickle"] });
    try {
      expect(resolveComboThinkingUsage(created)).toBeNull();
      expect(resolveComboThinkingUsage({ ...created, thinkingUsageMode: "auto" })).toBeNull();

      const off = await updateCombo(created.id, { thinkingUsageMode: "off" });
      expect(resolveComboThinkingUsage(off)).toEqual({ mode: "off", minRatio: null, maxRatio: null });

      const tuned = await updateCombo(created.id, { thinkingUsageMode: "always", thinkingUsageMinRatio: 0.2, thinkingUsageMaxRatio: 0.6 });
      expect(resolveComboThinkingUsage(tuned)).toEqual({ mode: "always", minRatio: 0.2, maxRatio: 0.6 });

      // auto + ratios only = explicit auto with custom ratio
      const ratioOnly = await updateCombo(created.id, { thinkingUsageMode: null, thinkingUsageMinRatio: 0.3, thinkingUsageMaxRatio: 0.9 });
      expect(resolveComboThinkingUsage(ratioOnly)).toEqual({ mode: "auto", minRatio: 0.3, maxRatio: 0.9 });
    } finally {
      await deleteCombo(created.id);
    }

    const media = await createCombo({ name: nextName(), kind: "web", models: [] });
    try {
      expect(resolveComboThinkingUsage(media)).toBeNull();
    } finally {
      await deleteCombo(media.id);
    }
  });

  it("partial updates (media-combo style {models} patches) cannot wipe the config", async () => {
    const created = await createCombo({ name: nextName(), models: ["oc/big-pickle"], thinkingUsageMode: "always", thinkingUsageMinRatio: 0.1, thinkingUsageMaxRatio: 0.9 });
    try {
      const patched = await updateCombo(created.id, { models: ["oc/muse-spark"] });
      expect(patched.thinkingUsageMode).toBe("always");
      expect(patched.thinkingUsageMinRatio).toBe(0.1);
      expect(patched.thinkingUsageMaxRatio).toBe(0.9);
    } finally {
      await deleteCombo(created.id);
    }
  });

  it("exportDb carries the fields and importDb round-trips them; legacy payloads default to null", async () => {
    const name = nextName();
    const created = await createCombo({ name, models: [], thinkingUsageMode: "off", thinkingUsageMinRatio: 0.25, thinkingUsageMaxRatio: 0.75 });
    try {
      const exported = await exportDb();
      const combo = exported.combos.find((c) => c.name === name);
      expect(combo).toMatchObject({ thinkingUsageMode: "off", thinkingUsageMinRatio: 0.25, thinkingUsageMaxRatio: 0.75 });

      // full roundtrip preserves the values
      await importDb(JSON.parse(JSON.stringify(exported)));
      const reimported = await getComboByName(name);
      expect(reimported).toMatchObject({ thinkingUsageMode: "off", thinkingUsageMinRatio: 0.25, thinkingUsageMaxRatio: 0.75 });

      // legacy payload without the new fields → all-NULL (legacy auto/0.75)
      await importDb(JSON.parse(JSON.stringify({ ...exported, combos: [{ id: created.id, name, models: [] }] })));
      const legacy = await getComboByName(name);
      expect(legacy.thinkingUsageMode).toBeNull();
      expect(legacy.thinkingUsageMinRatio).toBeNull();
      expect(legacy.thinkingUsageMaxRatio).toBeNull();
      expect(resolveComboThinkingUsage(legacy)).toBeNull();
    } finally {
      await deleteCombo(created.id);
    }
  });
});
