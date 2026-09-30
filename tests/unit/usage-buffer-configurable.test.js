import { afterEach, describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import {
  DEFAULT_BUFFER_TOKENS,
  addBufferToUsage,
  getBufferTokens
} from "../../open-sse/utils/usageTracking.js";

/**
 * The client-side context margin has to be switchable off (#3890).
 *
 * `addBufferToUsage` pads the usage a client is shown so the client compacts slightly
 * early. A client that keeps its own token statistics has no way to know that, so every
 * turn it stores is 2000 input tokens too high, and until now there was no way to turn
 * the padding off. `USAGE_BUFFER_TOKENS` sets it; `0` disables it.
 *
 * The default must not move: these pin that an unset variable still pads by 2000, and
 * that an unusable value falls back to 2000 rather than silently disabling the margin.
 */

const ORIGINAL = process.env.USAGE_BUFFER_TOKENS;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.USAGE_BUFFER_TOKENS;
  else process.env.USAGE_BUFFER_TOKENS = ORIGINAL;
});

describe("getBufferTokens", () => {
  it("defaults to 2000 when the variable is absent or blank", () => {
    delete process.env.USAGE_BUFFER_TOKENS;
    expect(getBufferTokens()).toBe(DEFAULT_BUFFER_TOKENS);
    expect(DEFAULT_BUFFER_TOKENS).toBe(2000);

    for (const blank of ["", "   "]) {
      process.env.USAGE_BUFFER_TOKENS = blank;
      expect(getBufferTokens(), JSON.stringify(blank)).toBe(DEFAULT_BUFFER_TOKENS);
    }
  });

  it("takes any non-negative integer, including 0", () => {
    for (const [raw, expected] of [["0", 0], ["500", 500], [" 1500 ", 1500], ["8000", 8000]]) {
      process.env.USAGE_BUFFER_TOKENS = raw;
      expect(getBufferTokens(), raw).toBe(expected);
    }
  });

  it("falls back to the default on a value it cannot use", () => {
    // A typo must not disable the margin by accident, and a fractional token count is
    // not reportable, so both keep the documented default.
    for (const raw of ["abc", "-1", "1.5", "1e3x", "NaN", "Infinity", "2,000"]) {
      process.env.USAGE_BUFFER_TOKENS = raw;
      expect(getBufferTokens(), raw).toBe(DEFAULT_BUFFER_TOKENS);
    }
  });
});

describe("addBufferToUsage", () => {
  it("adds the configured margin to both field namings", () => {
    process.env.USAGE_BUFFER_TOKENS = "500";
    expect(addBufferToUsage({ input_tokens: 737, output_tokens: 11 }))
      .toEqual({ input_tokens: 1237, output_tokens: 11 });
    expect(addBufferToUsage({ prompt_tokens: 737, completion_tokens: 11, total_tokens: 748 }))
      .toEqual({ prompt_tokens: 1237, completion_tokens: 11, total_tokens: 1248 });
  });

  it("leaves the counts alone at 0, but still derives a missing total", () => {
    process.env.USAGE_BUFFER_TOKENS = "0";
    expect(addBufferToUsage({ input_tokens: 737, output_tokens: 11, cache_read_input_tokens: 20992 }))
      .toEqual({ input_tokens: 737, output_tokens: 11, cache_read_input_tokens: 20992 });

    // Deriving total_tokens is normalization rather than padding, so it must survive
    // being switched off -- a client reading total_tokens still needs one.
    expect(addBufferToUsage({ prompt_tokens: 737, completion_tokens: 11 }))
      .toEqual({ prompt_tokens: 737, completion_tokens: 11, total_tokens: 748 });
  });
});

/**
 * The wiring, not just the helper: drive a real translated stream and compare the usage
 * the client is emitted against the usage handed to onStreamComplete for recording.
 *
 * Signature is (targetFormat, sourceFormat, ...) -- targetFormat is what the UPSTREAM
 * speaks, sourceFormat is what the CLIENT speaks.
 */
async function runStream(chunks) {
  const encoder = new TextEncoder();
  const input = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";

  let recorded = null;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    }
  });

  const output = stream.pipeThrough(
    createSSETransformStreamWithLogger(
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
      "deepseek",
      null,
      null,
      "deepseek-flash",
      null,
      { messages: [{ role: "user", content: "hi" }] },
      (_content, usage) => { recorded = usage; }
    )
  );

  const reader = output.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();

  const delta = text
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l.includes('"type":"message_delta"'))
    .map((l) => JSON.parse(l.slice(6)));

  return { clientUsage: delta.at(-1)?.usage ?? null, recorded };
}

const STREAM = [
  {
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 1700000000,
    model: "deepseek-flash",
    choices: [{ index: 0, delta: { role: "assistant", content: "ok" } }]
  },
  {
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 1700000000,
    model: "deepseek-flash",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 737, completion_tokens: 11, total_tokens: 748 }
  }
];

describe("the margin the client is actually emitted", () => {
  it("is the recorded figure plus the configured margin", async () => {
    process.env.USAGE_BUFFER_TOKENS = "500";
    const { clientUsage, recorded } = await runStream(STREAM);

    // The recorded copy keeps the provider's figure; only the emitted one is padded.
    expect(recorded?.input_tokens, "provider usage was not recorded at all").toBe(737);
    expect(clientUsage?.input_tokens).toBe(737 + 500);
    expect(clientUsage.input_tokens - recorded.input_tokens).toBe(500);
  });

  it("is the recorded figure itself at 0", async () => {
    process.env.USAGE_BUFFER_TOKENS = "0";
    const { clientUsage, recorded } = await runStream(STREAM);

    expect(recorded?.input_tokens).toBe(737);
    expect(clientUsage?.input_tokens).toBe(737);
    expect(clientUsage.input_tokens - recorded.input_tokens).toBe(0);
  });

  it("still pads by 2000 when nothing is configured", async () => {
    delete process.env.USAGE_BUFFER_TOKENS;
    const { clientUsage, recorded } = await runStream(STREAM);

    expect(recorded?.input_tokens).toBe(737);
    expect(clientUsage?.input_tokens).toBe(737 + 2000);
  });
});
