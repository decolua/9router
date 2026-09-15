import { describe, expect, it } from "vitest";

import { createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { pipeWithDisconnect } from "../../open-sse/utils/streamHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// An OpenAI client only ends a turn deliberately when it receives a chunk with a
// truthy finish_reason. pi hard-requires it (`supportsFinishReason` is
// unconditionally true), so a stream that ends without one aborts the request with
// "Stream ended without finish_reason" — hiding whether the reply was truncated.
//
// Upstreams end without a finish_reason when the response is empty or the stream is
// cut before its terminal chunk. That must become a deliberate `network_error`
// terminal instead of a missing one.
const CONTENT = 'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n';
const FINISH = 'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n';

function body(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function read(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

const passthrough = (chunks, { sourceFormat = FORMATS.OPENAI, provider = "deepseek" } = {}) =>
  read(body(chunks).pipeThrough(
    createPassthroughStreamWithLogger(provider, null, "deepseek-flash", null, { messages: [] }, null, null, sourceFormat),
  ));

const translate = (chunks, { sourceFormat = FORMATS.OPENAI, targetFormat = FORMATS.COMMANDCODE } = {}) =>
  read(body(chunks).pipeThrough(
    createSSETransformStreamWithLogger(targetFormat, sourceFormat, "commandcode", null, null, "deepseek/deepseek-v4.1-flash", null, { messages: [] }),
  ));

// Dispatch frames the way a spec-compliant OpenAI client does.
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

const finishReasons = (parsed) =>
  parsed.flatMap((c) => (c.choices?.[0]?.finish_reason ? [c.choices[0].finish_reason] : []));

const doneCount = (parsed) => parsed.filter((c) => c.done).length;

describe("aborted OpenAI stream: a terminal is synthesized", () => {
  const truncated = [
    ["ends with EOF and no terminal frame", [CONTENT]],
    ["sends only the [DONE] sentinel", ["data: [DONE]\n\n"]],
    ["returns an entirely empty body", []],
    ["is cut in the middle of a frame", [CONTENT, 'data: {"choices":[{"index":0,"delta":{"content":"wor']],
  ];

  for (const [name, chunks] of truncated) {
    it(`passthrough: upstream ${name}`, async () => {
      const parsed = frames(await passthrough(chunks));
      expect(finishReasons(parsed)).toEqual(["network_error"]);
      expect(doneCount(parsed)).toBe(1);
    });
  }

  it("translate: upstream ends with EOF and no terminal frame", async () => {
    const parsed = frames(await translate([CONTENT]));
    expect(finishReasons(parsed)).toEqual(["network_error"]);
    expect(doneCount(parsed)).toBe(1);
  });

  it("translate: upstream returns an entirely empty body", async () => {
    const parsed = frames(await translate([]));
    expect(finishReasons(parsed)).toEqual(["network_error"]);
    expect(doneCount(parsed)).toBe(1);
  });
});

describe("healthy OpenAI stream: the native terminal is left alone", () => {
  it("passthrough keeps the upstream finish_reason and emits one [DONE]", async () => {
    const parsed = frames(await passthrough([CONTENT, FINISH, "data: [DONE]\n\n"]));
    expect(finishReasons(parsed)).toEqual(["stop"]);
    expect(doneCount(parsed)).toBe(1);
  });

  it("passthrough emits one [DONE] when the upstream closes without its own", async () => {
    const parsed = frames(await passthrough([CONTENT, FINISH]));
    expect(finishReasons(parsed)).toEqual(["stop"]);
    expect(doneCount(parsed)).toBe(1);
  });

  it("translate keeps the upstream finish_reason instead of synthesizing one", async () => {
    const parsed = frames(await translate([CONTENT, FINISH, "data: [DONE]\n\n"]));
    expect(finishReasons(parsed)).toEqual(["stop"]);
  });
});

describe("streams that must not gain a synthesized terminal", () => {
  it("gemini-family passthrough gets neither a terminal nor [DONE]", async () => {
    const sse = await passthrough([CONTENT], { provider: "gemini" });
    expect(sse).not.toContain("[DONE]");
    expect(sse).not.toContain("network_error");
  });

  it("a non-OpenAI client format is untouched", async () => {
    const sse = await passthrough([CONTENT], { sourceFormat: FORMATS.CLAUDE });
    expect(sse).not.toContain("network_error");
  });

  it("a non-OpenAI client format in translate mode is untouched", async () => {
    const sse = await translate([CONTENT], { sourceFormat: FORMATS.CLAUDE });
    expect(sse).not.toContain("network_error");
  });
});

// A mid-stream transport error makes the writable side error, so flush() never runs and
// the clean-EOF terminal above is never synthesized. pipeWithDisconnect covers that via
// onAbortTerminal — which used to be wired for Responses clients only.
const fakeController = () => ({
  signal: new AbortController().signal,
  startTime: Date.now(),
  isConnected: () => true,
  handleComplete() {},
  handleError() {},
  handleDisconnect() {},
  abort() {},
});

// One content frame, then a transport-level reset.
function resettingBody(chunks = [CONTENT]) {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
      else controller.error(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
    },
  });
}

const passthroughWithAbortTerminal = (chunks) => {
  const ts = createPassthroughStreamWithLogger("deepseek", null, "deepseek-flash", null, { messages: [] }, null, null, FORMATS.OPENAI);
  const response = new Response(resettingBody(chunks), { status: 200 });
  return read(pipeWithDisconnect(response, ts, fakeController(), ts.abortTerminalBytes || null, 60_000));
};

describe("aborted OpenAI stream: mid-stream transport error", () => {
  it("still synthesizes a terminal after partial content", async () => {
    const parsed = frames(await passthroughWithAbortTerminal());
    expect(finishReasons(parsed)).toEqual(["network_error"]);
    expect(doneCount(parsed)).toBe(1);
  });

  it("synthesizes a terminal when the reset happens before any frame", async () => {
    const parsed = frames(await passthroughWithAbortTerminal([]));
    expect(finishReasons(parsed)).toEqual(["network_error"]);
    expect(doneCount(parsed)).toBe(1);
  });

  it("exposes no abort terminal once a terminal has already been emitted", async () => {
    const ts = createPassthroughStreamWithLogger("deepseek", null, "deepseek-flash", null, { messages: [] }, null, null, FORMATS.OPENAI);
    await read(body([CONTENT, FINISH]).pipeThrough(ts));
    expect(ts.abortTerminalBytes()).toBe(null);
  });

  it("has no abort terminal for non-OpenAI client formats", async () => {
    const ts = createPassthroughStreamWithLogger("deepseek", null, "deepseek-flash", null, { messages: [] }, null, null, FORMATS.CLAUDE);
    expect(ts.abortTerminalBytes).toBe(null);
  });
});
