import { describe, expect, it, vi } from "vitest";

import { createDeferredResponsesResponse } from "../../open-sse/utils/responsesStreamBridge.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CODEX_KEEPALIVE = 'event: 9router.keepalive\ndata: {"type":"9router.keepalive"}\n\n';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function readWithTimeout(reader, timeoutMs = 500) {
  return Promise.race([
    reader.read(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timed out waiting for stream data")), timeoutMs)),
  ]);
}

async function readAll(response) {
  const reader = response.body.getReader();
  return readReaderAll(reader);
}

async function readReaderAll(reader) {
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

describe("deferred Responses streaming", () => {
  it("sends an immediate comment and keepalives before provider headers", async () => {
    const provider = deferred();
    const response = createDeferredResponsesResponse(
      () => provider.promise,
      { keepaliveMs: 20 },
    );
    const reader = response.body.getReader();

    const first = await readWithTimeout(reader);
    expect(decoder.decode(first.value)).toBe(": connected\n\n");

    const second = await readWithTimeout(reader);
    expect(decoder.decode(second.value)).toBe(": keepalive\n\n");

    const upstream = "event: response.completed\ndata: {\"type\":\"response.completed\"}\n\ndata: [DONE]\n\n";
    provider.resolve(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(upstream));
        controller.close();
      },
    }), { headers: { "Content-Type": "text/event-stream" } }));

    let remainder = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      remainder += decoder.decode(value, { stream: true });
    }
    remainder += decoder.decode();
    expect(remainder).toContain(upstream);
  });

  it("converts a delayed JSON error into response.failed and DONE", async () => {
    const response = createDeferredResponsesResponse(
      async () => new Response(JSON.stringify({ error: { message: "provider unavailable" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
      { keepaliveMs: 60_000, model: "gpt-5.6-sol" },
    );

    const output = await readAll(response);
    expect(output).toContain("event: response.failed");
    expect(output).toContain("provider unavailable");
    expect(output).toContain("data: [DONE]");
    expect(output).not.toContain("data: {\"error\"");

    const failed = JSON.parse(output.split("\n").find((line) => line.startsWith("data: {")).slice(6));
    expect(failed).toMatchObject({
      type: "response.failed",
      sequence_number: 1,
      response: {
        object: "response",
        status: "failed",
        model: "gpt-5.6-sol",
        output: [],
        error: { code: "upstream_error", message: "provider unavailable" },
      },
    });
    expect(failed.response.id).toMatch(/^resp_/);
    expect(failed.response.created_at).toEqual(expect.any(Number));
  });

  it("sends Codex event keepalives after provider headers while SSE is idle", async () => {
    let upstreamController;
    const upstream = new ReadableStream({
      start(controller) {
        upstreamController = controller;
        controller.enqueue(encoder.encode('event: response.created\ndata: {"type":"response.created"}\n\n'));
      },
    });
    const response = createDeferredResponsesResponse(
      async () => new Response(upstream, { headers: { "Content-Type": "text/event-stream" } }),
      { keepaliveMs: 20, eventKeepalive: true },
    );
    const reader = response.body.getReader();

    expect(decoder.decode((await readWithTimeout(reader)).value)).toBe(": connected\n\n");
    expect(decoder.decode((await readWithTimeout(reader)).value)).toContain("response.created");
    expect(decoder.decode((await readWithTimeout(reader)).value)).toBe(CODEX_KEEPALIVE);

    upstreamController.enqueue(encoder.encode('event: response.completed\ndata: {"type":"response.completed"}\n\ndata: [DONE]\n\n'));
    upstreamController.close();
    expect(await readReaderAll(reader)).toContain("response.completed");
  });

  it("preserves fragmented provider SSE bytes without inserting keepalives", async () => {
    const provider = deferred();
    const response = createDeferredResponsesResponse(
      () => provider.promise,
      { keepaliveMs: 10, eventKeepalive: true },
    );
    const reader = response.body.getReader();

    await readWithTimeout(reader);

    const first = "event: response.output_text.delta\ndata: {\"type\":\"response.output_";
    const second = "text.delta\",\"delta\":\"OK\"}\n\ndata: [DONE]\n\n";
    provider.resolve(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(first));
        setTimeout(() => {
          controller.enqueue(encoder.encode(second));
          controller.close();
        }, 30);
      },
    }), { headers: { "Content-Type": "text/event-stream" } }));

    expect(await readReaderAll(reader)).toBe(first + second);
  });

  it("reads one provider chunk per downstream pull", async () => {
    const provider = deferred();
    let pulls = 0;
    const upstream = new ReadableStream({
      pull(controller) {
        pulls++;
        controller.enqueue(encoder.encode(`chunk-${pulls}`));
        if (pulls === 3) controller.close();
      },
    }, { highWaterMark: 0 });
    const response = createDeferredResponsesResponse(
      () => provider.promise,
      { keepaliveMs: 60_000 },
    );
    const reader = response.body.getReader();

    await readWithTimeout(reader);
    provider.resolve(new Response(upstream, { headers: { "Content-Type": "text/event-stream" } }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(pulls).toBe(1);
    await reader.cancel("test complete");
  });

  it("aborts pending provider work when downstream cancels", async () => {
    let workSignal;
    const response = createDeferredResponsesResponse((signal) => {
      workSignal = signal;
      return new Promise(() => {});
    }, { keepaliveMs: 60_000 });
    const reader = response.body.getReader();

    await readWithTimeout(reader);
    await reader.cancel("client closed");

    expect(workSignal.aborted).toBe(true);
  });

  it("closes the stream when the inbound request signal aborts", async () => {
    const request = new AbortController();
    let workSignal;
    const response = createDeferredResponsesResponse((signal) => {
      workSignal = signal;
      return new Promise(() => {});
    }, { signal: request.signal, keepaliveMs: 60_000 });
    const reader = response.body.getReader();

    await readWithTimeout(reader);
    request.abort("request closed");

    expect(workSignal.aborted).toBe(true);
    await expect(readWithTimeout(reader)).resolves.toEqual({ value: undefined, done: true });
  });

  it("does not start provider work for an already-aborted request", async () => {
    const request = new AbortController();
    request.abort("request closed");
    const run = vi.fn();
    const response = createDeferredResponsesResponse(run, {
      signal: request.signal,
      keepaliveMs: 60_000,
    });

    await expect(readWithTimeout(response.body.getReader())).resolves.toEqual({ value: undefined, done: true });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("provider abort propagation", () => {
  it("aborts provider fetch when external client signal closes", () => {
    vi.useFakeTimers();
    const client = new AbortController();
    const onDisconnect = vi.fn();
    const stream = createStreamController({ externalSignal: client.signal, onDisconnect });

    client.abort("client closed");

    expect(stream.signal.aborted).toBe(true);
    expect(stream.isConnected()).toBe(false);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("removes external abort listener after normal completion", () => {
    const client = new AbortController();
    const onDisconnect = vi.fn();
    const stream = createStreamController({ externalSignal: client.signal, onDisconnect });

    stream.handleComplete();
    client.abort("late close");

    expect(stream.signal.aborted).toBe(false);
    expect(onDisconnect).not.toHaveBeenCalled();
  });
});
