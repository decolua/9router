import { describe, expect, it } from "vitest";

import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

// A passthrough provider (DeepSeek, any OpenAI-compatible upstream) streams
// "data: {...}" lines. An SSE event only dispatches on a blank line, so a final
// data line that arrives without its trailing blank line stays in the flush
// buffer. The flush used to emit that buffer verbatim and then append
// "data: [DONE]\n\n" with no separator — both collapsed into a single data line
// and became one unparsable frame, so the client never saw the finish_reason.
async function runPassthrough(input, provider = "deepseek") {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of input) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });

  const output = stream.pipeThrough(
    createPassthroughStreamWithLogger(provider, null, "deepseek-v4-pro", null, { messages: [] }),
  );

  const reader = output.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

// Dispatch frames the way a spec-compliant SSE client does: split on the blank
// line, join the data lines of one frame with "\n", then parse.
function frames(sse) {
  return sse
    .split("\n\n")
    .filter((frame) => frame.trim())
    .map((frame) => {
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (data === "[DONE]") return { done: true };
      return JSON.parse(data);
    });
}

const content = 'data: {"choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n';
const finish = 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}';

describe("Passthrough flush keeps the buffered tail a separate frame", () => {
  const finishReasons = (parsed) => parsed
    .flatMap((c) => c.choices?.[0]?.finish_reason ? [c.choices[0].finish_reason] : []);

  it("delivers finish_reason when the tail ends with a single newline", async () => {
    const parsed = frames(await runPassthrough([content, finish + "\n"]));
    expect(parsed.map((c) => c.choices?.[0]?.delta?.content || "").join("")).toBe("hi");
    expect(finishReasons(parsed)).toEqual(["stop"]);
  });

  it("delivers finish_reason when the tail arrives without any newline", async () => {
    const parsed = frames(await runPassthrough([content, finish]));
    expect(finishReasons(parsed)).toEqual(["stop"]);
  });

  it("keeps the tail and the sentinel as separate frames", async () => {
    const parsed = frames(await runPassthrough([content, finish]));
    expect(finishReasons(parsed)).toEqual(["stop"]);
    expect(parsed.some((c) => c.done)).toBe(true);
  });

  it("is unchanged when the tail is already newline-terminated", async () => {
    const sse = await runPassthrough([content, finish + "\n\n", "data: [DONE]\n\n"]);
    expect(finishReasons(frames(sse))).toEqual(["stop"]);
    // The healthy path must not gain a stray blank line.
    expect(sse).not.toContain("\n\n\n");
  });

  it("still withholds the sentinel from gemini-family clients", async () => {
    const sse = await runPassthrough([content, finish], "gemini");
    expect(sse).not.toContain("data: [DONE]");
    expect(finishReasons(frames(sse))).toEqual(["stop"]);
  });
});
