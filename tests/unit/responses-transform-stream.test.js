import { describe, expect, it } from "vitest";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

// /v1/responses re-frames a chat-completions SSE stream as Responses API events
// for clients like Codex CLI.
async function runResponsesTransform(chunks) {
  const enc = new TextEncoder();
  const source = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? enc.encode(chunk) : chunk);
      controller.close();
    },
  });

  const out = source.pipeThrough(createResponsesApiTransformStream(null));
  const reader = out.getReader();
  const dec = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
  }
  text += dec.decode();

  return text
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)));
}

const event = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
const contentDelta = (content) => event({ choices: [{ index: 0, delta: { content } }] });
const stop = () => event({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
const textOf = (events) => events
  .filter((e) => e.type === "response.output_text.delta")
  .map((e) => e.delta)
  .join("");

describe("Responses API transform", () => {
  it("survives a multi-byte character split across two network chunks", async () => {
    const bytes = new TextEncoder().encode(contentDelta("xin chào 世界"));
    const cut = bytes.indexOf(0xe4); // first byte of 世
    const events = await runResponsesTransform([bytes.slice(0, cut + 1), bytes.slice(cut + 1), stop()]);
    // A fresh decoder per chunk turned 世 into three replacement characters.
    expect(textOf(events)).toBe("xin chào 世界");
  });

  it("delivers an event that arrived without its blank-line terminator", async () => {
    const events = await runResponsesTransform([contentDelta("hello") + contentDelta(" world").trimEnd()]);
    expect(textOf(events)).toBe("hello world");
  });

  it("is unchanged for a well-formed stream", async () => {
    const events = await runResponsesTransform([contentDelta("hello"), contentDelta(" world"), stop(), "data: [DONE]\n\n"]);
    expect(textOf(events)).toBe("hello world");
    expect(events.at(-1).type).toBe("response.completed");
    expect(events.at(-1).response.status).toBe("completed");
  });

  it("emits one completed event, not one per flush path", async () => {
    const events = await runResponsesTransform([contentDelta("hi"), stop(), "data: [DONE]\n\n"]);
    expect(events.filter((e) => e.type === "response.completed").length).toBe(1);
  });
});
