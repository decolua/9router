import { describe, expect, it } from "vitest";
import { classifyPreContent, isRetryablePreContentError, withPreContentRetry } from "../../open-sse/utils/preContentRetry.js";

const encoder = new TextEncoder();

function sse(...events) {
  return new Response(encoder.encode(events.join("")), { headers: { "content-type": "text/event-stream" } });
}

// Stream that sends `prefix` then fails like undici's "terminated".
function dropping(prefix) {
  let sent = !prefix;
  return new Response(new ReadableStream({
    pull(controller) {
      if (!sent) { sent = true; controller.enqueue(encoder.encode(prefix)); return; }
      controller.error(new TypeError("terminated"));
    },
  }), { headers: { "content-type": "text/event-stream" } });
}

const HTTP2_FAIL = 'data: {"message":"Upstream HTTP/2 stream failed","code":502}\n\n';
const CONTENT = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
const ROLE_ONLY = 'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n';

function wrap(first, responses, attempts = 3) {
  let calls = 0;
  const logs = [];
  const response = withPreContentRetry(first, {
    attempts,
    delayMs: 1,
    reexecute: async () => responses[calls++],
    onRetry: (m) => logs.push(m),
  });
  return { response, logs, calls: () => calls };
}

describe("classifyPreContent", () => {
  it("holds metadata-only events and flags content or errors", () => {
    expect(classifyPreContent(ROLE_ONLY)).toEqual({ state: "hold" });
    expect(classifyPreContent(": ping\n\nevent: message_start\ndata: {\"type\":\"message_start\"}\n\n")).toEqual({ state: "hold" });
    expect(classifyPreContent(CONTENT)).toEqual({ state: "content" });
    expect(classifyPreContent(HTTP2_FAIL)).toMatchObject({ state: "error", message: "Upstream HTTP/2 stream failed" });
    expect(classifyPreContent('data: {"type":"response.failed","response":{"error":{"code":"server_error","message":"x"}}}\n\n'))
      .toMatchObject({ state: "error" });
  });

  it("ignores incomplete trailing events", () => {
    expect(classifyPreContent('data: {"message":"Upstream HTTP/2')).toEqual({ state: "hold" });
  });

  it("forwards permanent errors without retrying", () => {
    expect(classifyPreContent('data: {"error":{"message":"context_length_exceeded","type":"invalid_request_error"}}\n\n'))
      .toEqual({ state: "content" });
  });
});

describe("isRetryablePreContentError", () => {
  it("covers the reported upstream messages", () => {
    expect(isRetryablePreContentError({ message: "Upstream HTTP/2 stream failed", code: 502 })).toBe(true);
    expect(isRetryablePreContentError({ message: "The service is temporarily overloaded.   ", type: "upstream_error" })).toBe(true);
    expect(isRetryablePreContentError({ message: "upstream connection lost", code: 504 })).toBe(true);
    expect(isRetryablePreContentError({ message: "invalid tool schema", code: 400 })).toBe(false);
  });
});

describe("withPreContentRetry", () => {
  it("retries an error frame and streams the next attempt", async () => {
    const { response, logs, calls } = wrap(sse(ROLE_ONLY, HTTP2_FAIL), [sse(ROLE_ONLY, CONTENT)]);
    const text = await response.text();
    expect(text).toBe(ROLE_ONLY + CONTENT);
    expect(calls()).toBe(1);
    expect(logs[0]).toContain("Upstream HTTP/2 stream failed");
  });

  it("retries a socket drop before content", async () => {
    const { response, calls } = wrap(dropping(ROLE_ONLY), [sse(CONTENT)]);
    expect(await response.text()).toBe(CONTENT);
    expect(calls()).toBe(1);
  });

  it("retries an EOF with no content", async () => {
    const { response } = wrap(sse(ROLE_ONLY), [sse(CONTENT)]);
    expect(await response.text()).toBe(CONTENT);
  });

  it("does not retry once content was sent", async () => {
    const { response, calls } = wrap(dropping(CONTENT), [sse(CONTENT)]);
    await expect(response.text()).rejects.toThrow("terminated");
    expect(calls()).toBe(0);
  });

  it("forwards the error frame after exhausting retries", async () => {
    const { response, calls } = wrap(sse(HTTP2_FAIL), [sse(HTTP2_FAIL), sse(HTTP2_FAIL)], 2);
    expect(await response.text()).toBe(HTTP2_FAIL);
    expect(calls()).toBe(2);
  });

  it("stops on a non-retryable re-execute status", async () => {
    const { response, calls } = wrap(sse(HTTP2_FAIL), [new Response("bad", { status: 400 }), sse(CONTENT)]);
    expect(await response.text()).toBe(HTTP2_FAIL);
    expect(calls()).toBe(1);
  });

  it("is a passthrough when disabled", () => {
    const original = sse(CONTENT);
    expect(withPreContentRetry(original, { attempts: 0, delayMs: 1, reexecute: async () => null })).toBe(original);
  });
});
