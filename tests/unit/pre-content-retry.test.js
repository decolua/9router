import { describe, expect, it, vi } from "vitest";
import { inspectStreamingPrelude, isRetryablePreContentError, prepareStreamingResponse } from "../../open-sse/utils/preContentRetry.js";

const encoder = new TextEncoder();
const headers = { "content-type": "text/event-stream" };
const frame = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
const role = frame({ choices: [{ delta: { role: "assistant" } }] });
const content = frame({ choices: [{ delta: { content: "recovered" } }] }) + "data: [DONE]\n\n";
const reset = {
  name: "APIError",
  data: {
    message: "Connection reset by server", isRetryable: true,
    metadata: { code: "ECONNRESET", syscall: "", message: "ECONNRESET: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()" },
  },
};
const lost = {
  name: "APIError",
  data: { message: "Network connection failed", isRetryable: true, metadata: { code: "", syscall: "", message: "network connection was lost" } },
};
const interruption = {
  name: "APIError",
  data: {
    message: "Upstream response stream was interrupted", isRetryable: false,
    responseBody: '{"message":"Upstream response stream was interrupted","code":"upstream_stream_read_error"}',
  },
};

const sse = (text) => new Response(text, { headers });

function dropping(prefix) {
  let sent = false;
  return new Response(new ReadableStream({
    pull(controller) {
      if (sent) controller.error(new TypeError("terminated", { cause: { code: "ECONNRESET" } }));
      else { sent = true; controller.enqueue(encoder.encode(prefix)); }
    },
  }, { highWaterMark: 0 }), { headers });
}

describe("stream preflight", () => {
  it.each([reset, lost, interruption])("retries a relayed $data.message after metadata", async (payload) => {
    const first = sse(role + ": ping\n\n" + frame(payload));
    const reexecute = vi.fn(async () => sse(content));
    const { response } = await prepareStreamingResponse(first, { attempts: 1, reexecute });
    expect(await response.text()).toBe(content);
    expect(first.body.locked).toBe(false);
    expect(reexecute).toHaveBeenCalledOnce();
  });

  it.each([429, 503])("retries an in-band %i even without transient wording", async (status) => {
    const reexecute = vi.fn(async () => sse(content));
    const { response } = await prepareStreamingResponse(sse(frame({ error: { message: "boom", code: status } })), { attempts: 1, reexecute });
    expect(await response.text()).toBe(content);
    expect(reexecute).toHaveBeenCalledOnce();
  });

  it.each([() => sse(role), () => dropping(role)])("retries when EOF or a reset follows only metadata", async (first) => {
    const reexecute = vi.fn(async () => sse(content));
    const { response } = await prepareStreamingResponse(first(), { attempts: 1, reexecute });
    expect(await response.text()).toBe(content);
    expect(reexecute).toHaveBeenCalledOnce();
  });

  it("retains bytes from the accepted attempt and never retries its later read error", async () => {
    const first = dropping(content);
    const reexecute = vi.fn();
    const { response } = await prepareStreamingResponse(first, { attempts: 1, reexecute });
    const reader = response.body.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(content);
    await expect(reader.read()).rejects.toThrow("terminated");
    reader.releaseLock();
    expect(first.body.locked).toBe(false);
    expect(reexecute).not.toHaveBeenCalled();
  });

  it("returns the final error and its status when retries are exhausted", async () => {
    const reexecute = vi.fn(async () => sse(frame(lost)));
    const prepared = await prepareStreamingResponse(sse(frame(reset)), { attempts: 2, reexecute });
    expect(prepared).toMatchObject({ exhausted: true, error: { message: "Network connection failed" } });
    expect(prepared.response).toBeUndefined();
    expect(reexecute).toHaveBeenCalledTimes(2);
  });

  it("keeps an actual HTTP rejection from the replacement without multiplying retries", async () => {
    const reexecute = vi.fn(async () => new Response('{"error":{"message":"bad tools"}}', { status: 400 }));
    const prepared = await prepareStreamingResponse(sse(frame(reset)), { attempts: 3, reexecute });
    expect(prepared).toMatchObject({ exhausted: false, error: { message: "bad tools", status: 400 } });
    expect(reexecute).toHaveBeenCalledOnce();
  });

  it("reports permanent validation errors without replaying the request", async () => {
    const reexecute = vi.fn();
    const prepared = await prepareStreamingResponse(sse(frame({ error: { message: "invalid upstream tool schema", type: "invalid_request_error" } })), { attempts: 3, reexecute });
    expect(prepared).toMatchObject({ exhausted: false, error: { type: "invalid_request_error" } });
    expect(reexecute).not.toHaveBeenCalled();
    expect(isRetryablePreContentError({ message: "invalid tool schema", code: 400 })).toBe(false);
  });

  it("preflights with zero retries and preserves an in-band 524", async () => {
    const reexecute = vi.fn();
    const prepared = await prepareStreamingResponse(sse(frame({ error: { message: "timed out", status: 524 } })), { attempts: 0, reexecute });
    expect(prepared).toMatchObject({ exhausted: true, error: { status: 524 } });
    expect(reexecute).not.toHaveBeenCalled();
  });

  it.each([
    { choices: [{ index: 0, delta: { role: "assistant" } }, { index: 1, delta: { reasoning_content: "thinking" } }] },
    { type: "response.output_item.added", item: { type: "function_call", id: "fc_1", name: "lookup" } },
  ])("accepts semantic output without waiting for text (%j)", async (payload) => {
    const { response } = await inspectStreamingPrelude(sse(role + frame(payload)));
    expect(await response.text()).toBe(role + frame(payload));
  });

  it("does not accept comments, Claude message_start, or empty Responses deltas as usable output", async () => {
    const input = sse(": ping\r\n\r\n" + frame({ type: "message_start", message: { content: [] } }) + frame({ type: "response.output_text.delta", delta: "" }));
    const outcome = await inspectStreamingPrelude(input);
    expect(outcome.error).toMatchObject({ status: 502, message: expect.stringContaining("before sending any stream output") });
    expect(input.body.locked).toBe(false);
  });

  it("bounds the absolute wait even if upstream heartbeats arrive and cancellation cleanup hangs", async () => {
    vi.useFakeTimers();
    try {
      let upstream;
      const cancel = vi.fn(() => new Promise(() => {}));
      const body = new ReadableStream({ start(controller) { upstream = controller; }, cancel });
      const pending = inspectStreamingPrelude(new Response(body, { headers }), { timeoutMs: 150 });
      await vi.advanceTimersByTimeAsync(100);
      upstream.enqueue(encoder.encode(": ping\n\n" + role));
      await vi.advanceTimersByTimeAsync(50);
      await expect(pending).resolves.toMatchObject({ error: { status: 504, message: expect.stringContaining("first upstream stream output") } });
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("cancels the held upstream before any client bytes are sent", async () => {
    const client = new AbortController();
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    const reexecute = vi.fn();
    const pending = prepareStreamingResponse(new Response(body, { headers }), { signal: client.signal, attempts: 2, reexecute });
    client.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(reexecute).not.toHaveBeenCalled();
  });
});
