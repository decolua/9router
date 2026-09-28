import { describe, expect, it } from "vitest";

import { pipeWithDisconnect, createStreamController } from "../../open-sse/utils/streamHandler.js";
import { createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Agent clients (Hermes, openai-python loops) stop reading a chat-completions
// stream as soon as the chunk carrying `finish_reason` arrives and close the
// socket — before the provider's trailing usage chunk and `[DONE]`. The reader
// is cancelled, flush() never runs, and without a finalize on that close the
// request left no usage row, no "📊 DONE" line and no combo attribution.

const enc = new TextEncoder();
const sse = (obj) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);
const chunk = (delta, extra = {}) => ({
  id: "chatcmpl-x", object: "chat.completion.chunk", created: 1, model: "m",
  choices: [{ index: 0, delta, finish_reason: null }], ...extra,
});
const finishChunk = (reason, usage) => ({
  id: "chatcmpl-x", object: "chat.completion.chunk", created: 1, model: "m",
  choices: [{ index: 0, delta: {}, finish_reason: reason }],
  ...(usage ? { usage } : {}),
});

// Upstream that sends the given frames and then stays open, like a provider
// that has yet to send its trailing usage chunk when the client hangs up.
function upstreamResponse(frames) {
  return {
    body: new ReadableStream({
      start(controller) {
        for (const f of frames) controller.enqueue(sse(f));
      },
    }),
  };
}

const body = { model: "m", messages: [{ role: "user", content: "hi" }] };

// Reads until `stopWhen(text)` is true, then cancels like a closing client.
async function readThenClose(stream, stopWhen) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (stopWhen(text)) break;
  }
  await reader.cancel("client closed");
  // let the cancel propagate through the pipe chain
  await new Promise((r) => setTimeout(r, 20));
  return text;
}

function run({ frames, makeTransform, stopWhen }) {
  const completions = [];
  const transform = makeTransform((content, usage) => completions.push({ content, usage }));
  const controller = createStreamController({});
  const out = pipeWithDisconnect(upstreamResponse(frames), transform, controller);
  return { completions, done: readThenClose(out, stopWhen) };
}

const passthrough = (onComplete) =>
  createPassthroughStreamWithLogger("tokenharbor", null, "m", null, body, onComplete, null);

describe("client closes a chat-completions stream right after finish_reason", () => {
  it("passthrough: still completes the stream once, with the finish chunk's usage", async () => {
    const { completions, done } = run({
      frames: [
        chunk({ role: "assistant", content: "" }),
        chunk({ content: "Oi!" }),
        finishChunk("tool_calls", { prompt_tokens: 120, completion_tokens: 7, total_tokens: 127 }),
      ],
      makeTransform: passthrough,
      stopWhen: (t) => t.includes('"finish_reason":"tool_calls"'),
    });
    await done;
    expect(completions).toHaveLength(1);
    expect(completions[0].content.content).toBe("Oi!");
    expect(completions[0].usage.prompt_tokens).toBe(120);
    expect(completions[0].usage.completion_tokens).toBe(7);
  });

  it("passthrough: a finish chunk without usage still completes with an estimate", async () => {
    const { completions, done } = run({
      frames: [chunk({ content: "Oi, tudo bem?" }), finishChunk("stop")],
      makeTransform: passthrough,
      stopWhen: (t) => t.includes('"finish_reason":"stop"'),
    });
    await done;
    expect(completions).toHaveLength(1);
    expect(completions[0].usage.completion_tokens).toBeGreaterThan(0);
  });

  it("passthrough: a close BEFORE finish_reason is an abort and completes nothing", async () => {
    const { completions, done } = run({
      frames: [chunk({ content: "Oi" }), chunk({ content: " parcial" })],
      makeTransform: passthrough,
      stopWhen: (t) => t.includes("parcial"),
    });
    await done;
    expect(completions).toHaveLength(0);
  });

  it("translate (openai upstream → claude client): completes once when closed after the finish", async () => {
    const { completions, done } = run({
      frames: [
        chunk({ role: "assistant", content: "" }),
        chunk({ content: "Oi!" }),
        finishChunk("stop", { prompt_tokens: 50, completion_tokens: 3, total_tokens: 53 }),
      ],
      makeTransform: (onComplete) =>
        createSSETransformStreamWithLogger(FORMATS.OPENAI, FORMATS.CLAUDE, "tokenharbor", null, null, "m", null, body, onComplete, null),
      stopWhen: (t) => t.includes("message_delta"),
    });
    await done;
    expect(completions).toHaveLength(1);
    expect(completions[0].usage.prompt_tokens ?? completions[0].usage.input_tokens).toBe(50);
  });
});
