import { describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";
import { canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";

const text = { choices: [{ delta: { content: "Hello" } }] };
const finish = { choices: [{ delta: {}, finish_reason: "stop" }] };
const sse = (chunk) => `data: ${JSON.stringify(chunk)}\n\n`;
const done = "data: [DONE]\n\n";
const placeholder = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
const body = { messages: [{ role: "user", content: "Hello" }] };
const encoder = new TextEncoder();

function makeStream(onStreamComplete) {
  return createSSEStream({
    targetFormat: FORMATS.OPENAI,
    sourceFormat: FORMATS.CLAUDE,
    body,
    onStreamComplete,
  });
}

function events(output) {
  return [...output.matchAll(/^data: (\{.*\})$/gm)].map((match) => JSON.parse(match[1]));
}

async function run(frames, onStreamComplete) {
  const input = new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return events(await new Response(input.pipeThrough(makeStream(onStreamComplete))).text());
}

describe("OpenAI Chat Completions to Claude streaming usage", () => {
  it.each([true, false])("forwards the usage-only trailer with final newline=%s", async (newline) => {
    const onStreamComplete = vi.fn();
    const trailer = sse({
      choices: [],
      usage: {
        prompt_tokens: 8505,
        completion_tokens: 16,
        prompt_tokens_details: { cached_tokens: 8448, cache_creation_tokens: 7 },
      },
    });
    const result = await run([
      sse({ ...text, usage: placeholder }),
      sse({ ...finish, usage: placeholder }),
      newline ? trailer : trailer.trimEnd(),
      ...(newline ? [done] : []),
    ], onStreamComplete);

    expect(result.map(({ type }) => type)).toEqual([
      "message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop",
    ]);
    expect(result.at(-2)).toMatchObject({
      delta: { stop_reason: "end_turn" },
      usage: { input_tokens: 50, output_tokens: 16, cache_read_input_tokens: 8448, cache_creation_input_tokens: 7 },
    });
    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    expect(canonicalizeUsage(onStreamComplete.mock.calls[0][1])).toMatchObject({
      prompt_tokens: 8505,
      cached_tokens: 8448,
      cache_creation_input_tokens: 7,
    });
  });

  it("uses inline usage and does not add estimated padding", async () => {
    const result = await run([sse(text), sse({
      ...finish,
      usage: { prompt_tokens: 80, completion_tokens: 12, cached_tokens: 80 },
    }), done]);

    expect(result.at(-2).usage).toEqual({ input_tokens: 0, output_tokens: 12, cache_read_input_tokens: 80 });
    expect(result.at(-1).type).toBe("message_stop");
  });

  it.each([true, false])("finishes with estimated usage when no trailer arrives, with [DONE]=%s", async (sentinel) => {
    const result = await run([sse(text), sse(finish), ...(sentinel ? [done] : [])]);
    expect(result.at(-2).usage).toMatchObject({ estimated: true });
    expect(result.at(-1).type).toBe("message_stop");
  });

  it("bounds the wait when no usage, [DONE], or EOF arrives", async () => {
    vi.useFakeTimers();
    let upstream;
    const onStreamComplete = vi.fn();
    const input = new ReadableStream({ start(controller) { upstream = controller; } });
    const output = new Response(input.pipeThrough(makeStream(onStreamComplete))).text();
    try {
      upstream.enqueue(encoder.encode(sse(text) + sse(finish)));
      await vi.advanceTimersByTimeAsync(2999);
      expect(onStreamComplete).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(onStreamComplete).toHaveBeenCalledTimes(1);
    } finally {
      upstream.close();
      vi.useRealTimers();
    }
    expect(events(await output).at(-1).type).toBe("message_stop");
  });
});
