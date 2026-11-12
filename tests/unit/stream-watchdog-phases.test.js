// Stream watchdog budget (per-provider) and phase labelling (first-chunk vs stall).
import { describe, it, expect, vi, afterEach } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { STREAM_STALL_TIMEOUT_MS } from "../../open-sse/config/runtimeConfig.js";
import { pipeWithDisconnect, createStreamController } from "../../open-sse/utils/streamHandler.js";
import { buildStreamErrorBytes } from "../../open-sse/utils/streamHelpers.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// handleStreamingResponse persists a request-detail row; keep that off disk.
vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  appendRequestLog: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
}));

const enc = new TextEncoder();
async function readAll(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
// Upstream body that errors when the controller aborts, like a real fetch body.
function upstreamBody(ctrl, start) {
  return new ReadableStream({
    start(c) {
      ctrl.signal.addEventListener("abort", () => { try { c.error(new Error("aborted")); } catch { /* closed */ } }, { once: true });
      start?.(c);
    },
  });
}
const pipe = (body, ctrl, onSeen, ms = 50) => pipeWithDisconnect(
  { body }, new TransformStream(), ctrl,
  (message) => { onSeen(message); return buildStreamErrorBytes(504, message, FORMATS.OPENAI); },
  ms,
);

describe("phase-labelled watchdog abort (pipeWithDisconnect, 50 ms budget)", () => {
  it("zero-byte upstream → 'stream first-chunk timeout' + [DONE]", async () => {
    const ctrl = createStreamController({ provider: "ollama", model: "test" });
    let seen = null;
    const text = await readAll(pipe(upstreamBody(ctrl), ctrl, (m) => { seen = m; }));
    expect(seen).toBe("stream first-chunk timeout");
    expect(text).toContain('"stream first-chunk timeout"');
    expect(text).toContain("data: [DONE]");
  });

  it("empty chunk (Uint8Array(0)) then silence → 'stream first-chunk timeout'", async () => {
    const ctrl = createStreamController({ provider: "ollama", model: "test" });
    let seen = null;
    const text = await readAll(pipe(upstreamBody(ctrl, (c) => c.enqueue(new Uint8Array(0))), ctrl, (m) => { seen = m; }));
    expect(seen).toBe("stream first-chunk timeout");
    expect(text).toContain('"stream first-chunk timeout"');
    expect(text).toContain("data: [DONE]");
  });

  it("one chunk then silence → 'stream stall timeout'", async () => {
    const ctrl = createStreamController({ provider: "ollama", model: "test" });
    let seen = null;
    const text = await readAll(pipe(upstreamBody(ctrl, (c) => c.enqueue(enc.encode("data: hi\n\n"))), ctrl, (m) => { seen = m; }));
    expect(seen).toBe("stream stall timeout");
    expect(text).toContain('"stream stall timeout"');
  });

  it("a chunk every 30 ms for 300 ms re-arms the budget — completes without abort", async () => {
    const ctrl = createStreamController({ provider: "ollama", model: "test" });
    let seen = null;
    let n = 0;
    const body = new ReadableStream({
      async pull(c) {
        if (n >= 10) { c.close(); return; }
        await new Promise((r) => setTimeout(r, 30));
        c.enqueue(enc.encode(`data: ${n++}\n\n`));
      },
    });
    const text = await readAll(pipe(body, ctrl, (m) => { seen = m; }));
    expect(seen).toBe(null);
    expect(text).toContain("data: 9");
    expect(text).not.toContain("timeout");
  });
});

describe("handleStreamingResponse arms the provider budget", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetModules(); });

  // Silent upstream through the real handler; returns the stub controller's abort spy.
  async function armed(provider) {
    const { handleStreamingResponse } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");
    const streamController = {
      signal: new AbortController().signal, startTime: Date.now(), isConnected: () => true,
      handleComplete: vi.fn(), handleError: vi.fn(), handleDisconnect: vi.fn(), abort: vi.fn(),
    };
    await handleStreamingResponse({
      providerResponse: new Response(new ReadableStream({ start() {} }), { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      provider, model: "m", sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI,
      body: { model: "m", stream: true, messages: [] }, stream: true, requestStartTime: Date.now(),
      connectionId: "c", apiKey: "k", streamController, onStreamComplete: () => {}, streamDetailId: "d", reqTag: "t", log: {},
    });
    return streamController;
  }

  it("antigravity watchdog fires at 600000 ms, not at 360000 ms", async () => {
    vi.useFakeTimers();
    const ctrl = await armed("antigravity");
    await vi.advanceTimersByTimeAsync(STREAM_STALL_TIMEOUT_MS + 1000); // 361 s: global budget has passed
    expect(ctrl.abort).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600000 - STREAM_STALL_TIMEOUT_MS - 1000 + 1); // → 600 s
    expect(ctrl.abort).toHaveBeenCalledTimes(1);
    expect(ctrl.handleError.mock.calls[0][0].message).toBe("stream first-chunk timeout");
  });

  it("STREAM_FIRST_CHUNK_TIMEOUT_MS=1000 does not shorten antigravity chat streaming", async () => {
    vi.stubEnv("STREAM_FIRST_CHUNK_TIMEOUT_MS", "1000");
    vi.resetModules(); // re-evaluate runtimeConfig with the env set before import
    vi.useFakeTimers();
    const ctrl = await armed("antigravity");
    await vi.advanceTimersByTimeAsync(599000);
    expect(ctrl.abort).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1001);
    expect(ctrl.abort).toHaveBeenCalledTimes(1);
  });
});

describe("stall budget resolution (registry data)", () => {
  it("antigravity gets a 600000 ms watchdog budget", () => {
    expect(PROVIDERS.antigravity.stallTimeoutMs).toBe(600000);
  });

  it("existing qoder / qoder-cn budgets are unchanged (120000)", () => {
    expect(PROVIDERS.qoder.stallTimeoutMs).toBe(120000);
    expect(PROVIDERS["qoder-cn"].stallTimeoutMs).toBe(120000);
  });

  it("a provider with no registry value resolves to STREAM_STALL_TIMEOUT_MS", () => {
    expect(PROVIDERS.openai.stallTimeoutMs).toBeUndefined();
    // Same expression the streaming handler uses to arm the watchdog.
    expect(PROVIDERS.openai?.stallTimeoutMs || STREAM_STALL_TIMEOUT_MS).toBe(STREAM_STALL_TIMEOUT_MS);
    expect(STREAM_STALL_TIMEOUT_MS).toBe(360000);
  });
});