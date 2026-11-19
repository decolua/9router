import { describe, expect, it } from "vitest";

import { normalizeResponsesErrorEvent } from "../../open-sse/utils/responsesStreamHelpers.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";
import { openaiResponsesToOpenAIResponse } from "../../open-sse/translator/response/openai-responses.js";

async function runPassthrough(input) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });

  const output = stream.pipeThrough(createPassthroughStreamWithLogger(null, null, "gpt-5.6-sol"));
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

// Mirror of the Kilo CLI (opencode fork) stream-error classifier. It only builds
// a retryable APIError when the thrown error object has a string message, NO
// `type` field, and a numeric 429/5xx (or known retryable) code. A string `type`
// makes its envelope synthesis bail out, which produces the non-retryable
// UnknownError the user sees on every harness.
function kiloStreamErrorRetryable(error) {
  if (typeof error?.message !== "string" || error.type !== undefined) return false;
  if (typeof error.code === "number") return error.code === 429 || (error.code >= 500 && error.code < 600);
  return ["server_is_overloaded", "server_error", "rate_limit_exceeded"].includes(error.code);
}

describe("normalizeResponsesErrorEvent", () => {
  it("makes the reported 'temporarily overloaded' stream error retryable", () => {
    // Reported shape: the upstream streams { message, type } and every harness
    // shows it as a non-retryable UnknownError with the JSON blob as message.
    const out = normalizeResponsesErrorEvent({
      message: "The service is temporarily overloaded.   ",
      type: "upstream_error",
    });

    expect(out.error).toEqual({ message: "The service is temporarily overloaded.", code: 502 });
    expect(kiloStreamErrorRetryable(out.error)).toBe(true);
    // The pre-fix shape (string type, no code) is exactly what the harness
    // classifier rejects — keep this as the regression anchor.
    expect(kiloStreamErrorRetryable({ message: "The service is temporarily overloaded.", type: "upstream_error" })).toBe(false);
  });

  it("adds the nested error envelope to a flat upstream error", () => {
    // Reported shape: a Responses upstream reports a transport failure flat
    // ({ message, type, code }), which clients cannot classify — they surface it
    // as an unknown error and never retry.
    const out = normalizeResponsesErrorEvent({
      message: "Upstream HTTP/2 stream failed",
      type: "upstream_error",
      code: "upstream_http2_stream_error",
    });

    // Transient message → pinned to numeric 502 so harnesses retry.
    expect(out.error).toEqual({
      message: "Upstream HTTP/2 stream failed",
      code: 502,
    });
    expect(kiloStreamErrorRetryable(out.error)).toBe(true);
    // Original fields survive so nothing is lost for clients reading them.
    expect(out.message).toBe("Upstream HTTP/2 stream failed");
  });

  it("unwraps a stringified message into plain text", () => {
    const out = normalizeResponsesErrorEvent({
      message: JSON.stringify({
        message: "Upstream HTTP/2 stream failed",
        code: "upstream_http2_stream_error",
      }),
    });

    expect(out.error.message).toBe("Upstream HTTP/2 stream failed");
    expect(out.error.code).toBe(502);
    // The top-level message is replaced too — clients that read it must not get
    // the raw JSON blob (the reported "UnknownError" payload).
    expect(out.message).toBe("Upstream HTTP/2 stream failed");
  });

  it("normalizes a nested error envelope into the classifier-safe shape", () => {
    const payload = { type: "error", error: { message: "boom", type: "server_error", code: "x" } };

    // Non-transient message → upstream code kept, but the string `type` must go
    // or the harness classifier bails out.
    expect(normalizeResponsesErrorEvent(payload).error).toEqual({ message: "boom", code: "x" });
  });

  it("leaves normal stream events untouched", () => {
    const delta = { type: "response.output_text.delta", delta: "hi" };
    const completed = { type: "response.completed", response: { status: "completed" } };

    expect(normalizeResponsesErrorEvent(delta)).toBe(delta);
    expect(normalizeResponsesErrorEvent(completed)).toBe(completed);
  });
});

describe("passthrough stream error framing", () => {
  it("forwards a flat upstream error frame with the nested envelope", async () => {
    // OpenAI-compatible / Responses-speaking providers stream this flat shape;
    // passthrough used to forward it verbatim, so clients showed "unknown error".
    const payload = {
      message: "Upstream HTTP/2 stream failed",
      type: "upstream_error",
      code: "upstream_http2_stream_error",
    };

    const text = await runPassthrough(`event: error\ndata: ${JSON.stringify(payload)}\n\n`);
    const dataLine = text.split("\n").find((line) => line.startsWith("data: {"));

    const error = JSON.parse(dataLine.slice(5)).error;
    expect(error).toEqual({ message: "Upstream HTTP/2 stream failed", code: 502 });
    expect(kiloStreamErrorRetryable(error)).toBe(true);
  });
});

describe("Responses upstream → Chat client error translation", () => {
  it("surfaces a flat upstream error instead of dropping it", () => {
    // A flat payload has no `error` key, so the translator used to return null
    // and the Chat client saw the stream end with no explanation.
    const out = openaiResponsesToOpenAIResponse({
      type: "error",
      message: "Upstream HTTP/2 stream failed",
      code: "upstream_http2_stream_error",
    }, {});

    expect(out?.choices?.[0]?.delta?.content).toContain("Upstream HTTP/2 stream failed");
  });
});
