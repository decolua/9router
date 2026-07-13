import { describe, expect, it } from "vitest";

import { pipeWithDisconnect } from "../../open-sse/utils/streamHandler.js";

// Minimal stream controller stub (matches tests/unit/responses-abort-terminal.test.js).
function makeController() {
  let connected = true;
  return {
    signal: new AbortController().signal,
    startTime: Date.now(),
    isConnected: () => connected,
    handleComplete: () => { connected = false; },
    handleError: () => { connected = false; },
    handleDisconnect: () => { connected = false; },
    abort: () => { connected = false; },
  };
}

const enc = new TextEncoder();

// Read a stream for `ms` ms, then cancel. Used to observe keepalive output
// while upstream stays silent (never closes).
async function readForMs(stream, ms) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const res = await Promise.race([
      reader.read(),
      new Promise((r) => setTimeout(() => r({ done: true, timedOut: true }), remaining)),
    ]);
    if (res.timedOut) break;
    if (res.done) break;
    text += decoder.decode(res.value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return text;
}

describe("client keepalive heartbeat (pipeWithDisconnect)", () => {
  it("emits SSE comment when upstream silent beyond keepalive interval", async () => {
    // Silent upstream: never enqueues, never closes (simulates slow TTFT on huge context).
    const silentUpstream = new ReadableStream({ start() {} });
    const providerResponse = new Response(silentUpstream);

    const out = pipeWithDisconnect(
      providerResponse,
      new TransformStream(),
      makeController(),
      null,
      60_000, // stall timeout — irrelevant, upstream never stalls the byte timer
      { clientKeepaliveMs: 20 }
    );

    const text = await readForMs(out, 120);
    expect(text).toContain(": ka");
  });

  it("does not emit keepalive while upstream chunks flow within interval", async () => {
    // Chunks every 10ms, keepalive interval 50ms → timer always re-armed before firing.
    const flowing = new ReadableStream({
      start(controller) {
        let n = 0;
        const iv = setInterval(() => {
          controller.enqueue(enc.encode(`data: chunk-${n++}\n\n`));
          if (n > 8) { clearInterval(iv); controller.close(); }
        }, 10);
      }
    });

    const out = pipeWithDisconnect(
      new Response(flowing),
      new TransformStream(),
      makeController(),
      null,
      60_000,
      { clientKeepaliveMs: 50 }
    );

    const reader = out.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    expect(text).not.toContain(": ka");
    expect(text).toContain("chunk-0");
    expect(text).toContain("chunk-8");
  });

  it("forwards real chunks and injects keepalive during gaps", async () => {
    const gaps = new ReadableStream({
      async start(controller) {
        controller.enqueue(enc.encode("data: first\n\n"));
        await new Promise((r) => setTimeout(r, 80)); // gap > keepalive(20ms)
        controller.enqueue(enc.encode("data: second\n\n"));
        controller.close();
      }
    });

    const out = pipeWithDisconnect(
      new Response(gaps),
      new TransformStream(),
      makeController(),
      null,
      60_000,
      { clientKeepaliveMs: 20 }
    );

    const reader = out.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    expect(text).toContain("data: first");
    expect(text).toContain("data: second");
    expect(text).toContain(": ka");
  });

  it("disables keepalive when clientKeepaliveMs is 0", async () => {
    const silent = new ReadableStream({ start() {} });
    const out = pipeWithDisconnect(
      new Response(silent),
      new TransformStream(),
      makeController(),
      null,
      60_000,
      { clientKeepaliveMs: 0 }
    );

    const text = await readForMs(out, 80);
    expect(text).not.toContain(": ka");
  });
});
