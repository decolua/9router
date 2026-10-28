import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

// A provider can fail mid-stream inside an HTTP 200: Anthropic sends `event: error` (for example
// overloaded_error), and the Bedrock executor re-emits AWS in-band exceptions in the same shapes.
// When the client speaks a different format, that error has to survive translation, or the
// client sees a clean but truncated answer.

async function runTransform(targetFormat, sourceFormat, lines) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines.join("\n")));
      controller.close();
    },
  });
  const output = stream.pipeThrough(
    createSSETransformStreamWithLogger(targetFormat, sourceFormat, "test", null, null, "test-model"),
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

// Client-facing SSE as [{ event?, data }], skipping the [DONE] sentinel.
function parseEvents(text) {
  return text
    .split("\n\n")
    .map((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      if (!data || data === "[DONE]") return null;
      return { event, data: JSON.parse(data) };
    })
    .filter(Boolean);
}

const claudeSse = (data) => [`event: ${data.type}`, `data: ${JSON.stringify(data)}`, ""];
const sse = (data) => [`data: ${JSON.stringify(data)}`, ""];

// A Claude stream that starts answering, then fails the way Anthropic reports overload.
const CLAUDE_FAILING_STREAM = [
  ...claudeSse({ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5", content: [], usage: { input_tokens: 10, output_tokens: 1 } } }),
  ...claudeSse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
  ...claudeSse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Partial" } }),
  ...claudeSse({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }),
];

// The same failure from an OpenAI-shaped upstream (e.g. the Bedrock executor on its OpenAI wire).
const OPENAI_FAILING_STREAM = [
  ...sse({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "Partial" } }] }),
  ...sse({ error: { message: "Too many requests", type: "ThrottlingException", code: "ThrottlingException" } }),
];

describe("in-band stream errors survive format translation", () => {
  it("Claude upstream -> OpenAI client: emits a Chat Completions error chunk", async () => {
    const events = parseEvents(await runTransform(FORMATS.CLAUDE, FORMATS.OPENAI, CLAUDE_FAILING_STREAM));

    expect(events.some((e) => e.data.choices?.[0]?.delta?.content === "Partial")).toBe(true);
    const error = events.find((e) => e.data.error)?.data.error;
    expect(error).toEqual({ message: "Overloaded", type: "overloaded_error", code: "overloaded_error" });
  });

  it("Claude upstream -> Codex (Responses) client: fails the response instead of completing it", async () => {
    const events = parseEvents(await runTransform(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, CLAUDE_FAILING_STREAM));

    const failed = events.filter((e) => e.event === "response.failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].data.response.status).toBe("failed");
    // codex-api deserialises response.error into Option<String> fields; a non-string breaks it.
    expect(failed[0].data.response.error).toEqual({ code: "overloaded_error", message: "Overloaded", type: "overloaded_error" });
    expect(events.some((e) => e.event === "response.completed")).toBe(false);
    expect(events.at(-1).event).toBe("response.failed");
  });

  it("OpenAI upstream -> Claude client: emits a Claude error event", async () => {
    const events = parseEvents(await runTransform(FORMATS.OPENAI, FORMATS.CLAUDE, OPENAI_FAILING_STREAM));

    const error = events.find((e) => e.event === "error");
    expect(error?.data).toEqual({ type: "error", error: { type: "ThrottlingException", message: "Too many requests" } });
    expect(events.some((e) => e.event === "message_stop")).toBe(false);
  });

  it("OpenAI upstream -> Codex (Responses) client: fails the response", async () => {
    const events = parseEvents(await runTransform(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, OPENAI_FAILING_STREAM));

    const failed = events.filter((e) => e.event === "response.failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].data.response.error).toEqual({ code: "ThrottlingException", message: "Too many requests", type: "ThrottlingException" });
    expect(events.some((e) => e.event === "response.completed")).toBe(false);
  });

  it("Claude upstream -> Antigravity client: passes the error chunk through", async () => {
    const events = parseEvents(await runTransform(FORMATS.CLAUDE, FORMATS.ANTIGRAVITY, CLAUDE_FAILING_STREAM));

    const error = events.find((e) => e.data.error)?.data.error;
    expect(error).toMatchObject({ message: "Overloaded", type: "overloaded_error" });
  });
});
