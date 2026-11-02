import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

// Codex compacts its history only from the token usage reported on `response.completed`
// (sess.get_total_token_usage). Without it Codex never compacts and eventually sends a
// prompt larger than the model's context window.

async function runTransform(targetFormat, lines) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines.join("\n")));
      controller.close();
    },
  });

  const output = stream.pipeThrough(
    createSSETransformStreamWithLogger(targetFormat, FORMATS.OPENAI_RESPONSES, "test", null, null, "test-model"),
  );

  const reader = output.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

// Parse the client-facing SSE into [{ event, data }], skipping the [DONE] sentinel.
function parseEvents(text) {
  return text
    .split("\n\n")
    .map((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      if (!event || !data || data === "[DONE]") return null;
      return { event, data: JSON.parse(data) };
    })
    .filter(Boolean);
}

const sse = (data) => [`data: ${JSON.stringify(data)}`, ""];
const claudeSse = (data) => [`event: ${data.type}`, `data: ${JSON.stringify(data)}`, ""];

// Mirrors ResponseCompletedUsage in codex-rs/codex-api/src/sse/responses.rs. The three totals
// are required i64s and the details are optional, but each detail field is a required i64
// when present. Any deviation fails Codex's parse of the whole event, killing the turn.
function expectCodexUsageShape(usage) {
  for (const field of ["input_tokens", "output_tokens", "total_tokens"]) {
    expect(Number.isInteger(usage[field]), field).toBe(true);
  }
  if (usage.input_tokens_details) {
    expect(Number.isInteger(usage.input_tokens_details.cached_tokens)).toBe(true);
  }
  if (usage.output_tokens_details) {
    expect(Number.isInteger(usage.output_tokens_details.reasoning_tokens)).toBe(true);
  }
}

describe("Responses response.completed reports token usage", () => {
  it("reports Claude upstream usage to a Codex client, counting cached prompt tokens", async () => {
    const events = parseEvents(await runTransform(FORMATS.CLAUDE, [
      ...claudeSse({
        type: "message_start",
        message: {
          id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5", content: [],
          usage: { input_tokens: 1000, cache_read_input_tokens: 200, cache_creation_input_tokens: 0, output_tokens: 1 },
        },
      }),
      ...claudeSse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      ...claudeSse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } }),
      ...claudeSse({ type: "content_block_stop", index: 0 }),
      ...claudeSse({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 50 } }),
      ...claudeSse({ type: "message_stop" }),
    ]));

    const completed = events.filter((e) => e.event === "response.completed");
    expect(completed).toHaveLength(1);

    const usage = completed[0].data.response.usage;
    expectCodexUsageShape(usage);
    expect(usage).toMatchObject({
      input_tokens: 1200,
      output_tokens: 50,
      total_tokens: 1250,
      input_tokens_details: { cached_tokens: 200 },
    });
  });

  it("waits for a trailing usage-only chunk instead of completing on finish_reason", async () => {
    const events = parseEvents(await runTransform(FORMATS.OPENAI, [
      ...sse({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "Hi" } }] }),
      ...sse({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
      ...sse({
        id: "c1", object: "chat.completion.chunk", choices: [],
        usage: {
          prompt_tokens: 300, completion_tokens: 20, total_tokens: 320,
          prompt_tokens_details: { cached_tokens: 100 },
          completion_tokens_details: { reasoning_tokens: 5 },
        },
      }),
      "data: [DONE]",
      "",
    ]));

    const completed = events.filter((e) => e.event === "response.completed");
    expect(completed).toHaveLength(1);
    // Terminal event last: Codex stops reading at response.completed.
    expect(events.at(-1).event).toBe("response.completed");

    const usage = completed[0].data.response.usage;
    expectCodexUsageShape(usage);
    expect(usage).toEqual({
      input_tokens: 300,
      output_tokens: 20,
      total_tokens: 320,
      input_tokens_details: { cached_tokens: 100 },
      output_tokens_details: { reasoning_tokens: 5 },
    });
  });

  it("ignores zeroed placeholder usage on every chunk and reports the real trailing counts", async () => {
    const placeholder = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const events = parseEvents(await runTransform(FORMATS.OPENAI, [
      ...sse({ id: "c3", object: "chat.completion.chunk", usage: placeholder, choices: [{ index: 0, delta: { role: "assistant", content: "Hi" } }] }),
      ...sse({ id: "c3", object: "chat.completion.chunk", usage: placeholder, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
      ...sse({ id: "c3", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 300, completion_tokens: 20, total_tokens: 320 } }),
      "data: [DONE]",
      "",
    ]));

    const completed = events.filter((e) => e.event === "response.completed");
    expect(completed).toHaveLength(1);
    expect(completed[0].data.response.usage).toEqual({ input_tokens: 300, output_tokens: 20, total_tokens: 320 });
  });

  it.each([0, 999])("derives the total when upstream reports inconsistent total_tokens=%i", async (totalTokens) => {
    const events = parseEvents(await runTransform(FORMATS.OPENAI, [
      ...sse({ id: "c4", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "Hi" } }] }),
      ...sse({
        id: "c4", object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 300, completion_tokens: 20, total_tokens: totalTokens },
      }),
      "data: [DONE]",
      "",
    ]));

    const completed = events.filter((e) => e.event === "response.completed");
    expect(completed).toHaveLength(1);
    expect(completed[0].data.response.usage).toEqual({
      input_tokens: 300,
      output_tokens: 20,
      total_tokens: 320,
    });
  });

  it("completes at [DONE] while the upstream connection remains open", async () => {
    let upstream;
    const input = new ReadableStream({
      start(controller) {
        upstream = controller;
      },
    });
    const reader = input.pipeThrough(
      createSSETransformStreamWithLogger(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "test"),
    ).getReader();
    const decoder = new TextDecoder();
    const frames = [
      ...sse({ id: "c5", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "Hi" } }] }),
      ...sse({ id: "c5", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
      "data: [DONE]",
      "",
    ];
    upstream.enqueue(new TextEncoder().encode(frames.join("\n") + "\n"));

    let timer;
    try {
      let output = "";
      const readUntilCompleted = async () => {
        while (!output.includes('"type":"response.completed"')) {
          const { value, done } = await reader.read();
          if (done) throw new Error("stream ended before response.completed");
          output += decoder.decode(value, { stream: true });
        }
      };
      await Promise.race([
        readUntilCompleted(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("response.completed waited for transport EOF")), 500);
        }),
      ]);
      expect(parseEvents(output).filter((e) => e.event === "response.completed")).toHaveLength(1);
    } finally {
      clearTimeout(timer);
      upstream.close();
      await reader.cancel();
    }
  });

  it("still completes exactly once, without inventing usage, when the upstream reports none", async () => {
    const events = parseEvents(await runTransform(FORMATS.OPENAI, [
      ...sse({ id: "c2", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "Hi" } }] }),
      ...sse({ id: "c2", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
      "data: [DONE]",
      "",
    ]));

    const completed = events.filter((e) => e.event === "response.completed");
    expect(completed).toHaveLength(1);
    expect(events.at(-1).event).toBe("response.completed");
    expect(completed[0].data.response).not.toHaveProperty("usage");
  });
});
