import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";

const { logTargetRequest, trackPendingRequest, saveRequestDetail } = vi.hoisted(() => ({
  logTargetRequest: vi.fn(), trackPendingRequest: vi.fn(), saveRequestDetail: vi.fn(async () => {}),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest, saveRequestDetail,
  appendRequestLog: async () => {},
  saveRequestUsage: async () => {},
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({ logRawRequest() {}, logTargetRequest }),
}));

vi.mock("../../open-sse/config/runtimeConfig.js", async (load) => {
  const config = await load();
  return {
    ...config,
    DEFAULT_RETRY_CONFIG: { ...config.DEFAULT_RETRY_CONFIG, 502: { attempts: 1, delayMs: 0 } },
    STREAM_PRECONTENT_RETRY_ATTEMPTS: 1,
    STREAM_PRECONTENT_RETRY_DELAY_MS: 0,
    STREAM_HEARTBEAT_INTERVAL_MS: 0,
  };
});

const provider = "openai-compatible-chat-loopback";
const model = "stream-test";
const connectionId = "loopback";
const frame = (delta, finishReason = null) => `data: ${JSON.stringify({
  choices: [{ index: 0, delta, finish_reason: finishReason }],
})}\n\n`;
const complete = frame({ content: "recovered" }) + frame({}, "stop") + "data: [DONE]\n\n";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NO_PROXY", "127.0.0.1");
  vi.stubEnv("FETCH_FRESH_RETRY", "off");
});
afterEach(() => {
  vi.unstubAllEnvs();
  logTargetRequest.mockReset();
});

async function withUpstream(respond, test) {
  const attempts = [];
  const server = createServer((request, response) => {
    let payload = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { payload += chunk; });
    request.on("end", () => {
      const attempt = { url: request.url, socket: request.socket, payload };
      attempts.push(attempt);
      respond(response, attempt, attempts.length);
    });
  });
  server.listen(0, "127.0.0.1");
  const abort = new AbortController();
  try {
    await once(server, "listening");
    const onRequestSuccess = vi.fn();
    const log = { line: vi.fn(), warn: vi.fn(), debug: vi.fn(), errorLine: vi.fn() };
    const run = () => handleChatCore({
      body: { model, stream: true, messages: [{ role: "user", content: "Hello" }], max_tokens: 123 },
      modelInfo: { provider, model },
      credentials: { apiKey: "loopback-test", providerSpecificData: {
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiType: "chat",
      } },
      connectionId, log, onRequestSuccess,
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(4000)]),
    });
    await test({ attempts, log, onRequestSuccess, run, abort });
  } finally {
    abort.abort();
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await closed;
  }
}

function startSse(response) {
  response.writeHead(200, { "Content-Type": "text/event-stream" });
}

async function readThrough(reader, marker) {
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (marker && text.includes(marker) && text.endsWith("\n\n")) return text;
  }
  if (marker) throw new Error(`Stream ended before ${marker}`);
  return text + decoder.decode();
}

describe("loopback 9router stream resets", () => {
  it("retries a reset before HTTP headers on a fresh socket", async () => {
    await withUpstream((res, attempt, index) => {
      if (index === 1) attempt.socket.resetAndDestroy();
      else { startSse(res); res.end(complete); }
    }, async ({ attempts, log, run }) => {
      const result = await run();
      expect(result.success).toBe(true);
      expect(await result.response.text()).toContain('"content":"recovered"');
      expect(attempts).toHaveLength(2);
      expect(attempts[0].socket).not.toBe(attempts[1].socket);
      expect(attempts[0].payload).toBe(attempts[1].payload);
      expect(log.debug).toHaveBeenCalledWith("RETRY", expect.stringContaining("network"));
    });
  });

  it.each([true, false])("handles a reset after 200 and only metadata (recovers: %s)", async (recovers) => {
    await withUpstream((res, _attempt, index) => {
      startSse(res);
      if (index === 2 && recovers) res.end(complete);
      else res.write(frame({ role: "assistant" }));
    }, async ({ attempts, log, onRequestSuccess, run }) => {
      // Reset after fetch returns the 200 headers, including on the retry.
      logTargetRequest.mockImplementationOnce(() => attempts[0].socket.resetAndDestroy());
      if (!recovers) logTargetRequest.mockImplementationOnce(() => attempts[1].socket.resetAndDestroy());
      const result = await run();
      const text = await result.response.text();
      expect(attempts).toHaveLength(2);
      expect(attempts[0].socket).not.toBe(attempts[1].socket);
      expect(attempts.map(({ url, payload }) => [url, JSON.parse(payload).max_tokens])).toEqual([
        ["/v1/chat/completions", 123], ["/v1/chat/completions", 123],
      ]);
      expect(attempts[0].payload).toBe(attempts[1].payload);
      expect(log.warn).toHaveBeenCalledWith("STREAM", expect.stringContaining("before first output"));
      expect(result.success).toBe(recovers);
      expect(result.response.status).toBe(recovers ? 200 : 502);
      expect(text).not.toContain('"role":"assistant"');
      expect(text).toContain(recovers ? '"content":"recovered"' : "before first output");
      expect(onRequestSuccess).toHaveBeenCalledTimes(recovers ? 1 : 0);
      expect(trackPendingRequest.mock.calls).toEqual([
        [model, provider, connectionId, true], [model, provider, connectionId, false, !recovers],
      ]);
      expect(saveRequestDetail).toHaveBeenLastCalledWith(expect.objectContaining({
        status: recovers ? "success" : "error", streamTelemetry: expect.objectContaining({ attemptCount: 2 }),
      }));
    });
  });

  it.each([
    ["text", { content: "visible-marker" }],
    ["reasoning", { reasoning_content: "visible-marker" }],
    ["tool call", { tool_calls: [{ index: 0, id: "call_visible-marker", type: "function", function: { name: "lookup", arguments: "{}" } }] }],
  ])("does not replay a real reset after visible %s", async (_kind, delta) => {
    await withUpstream((res) => { startSse(res); res.write(frame(delta)); }, async ({ attempts, log, onRequestSuccess, run }) => {
      const result = await run();
      expect(result.success).toBe(true);
      const reader = result.response.body.getReader();
      try {
        const head = await readThrough(reader, "visible-marker");
        attempts[0].socket.resetAndDestroy();
        const output = head + await readThrough(reader);
        expect(output.match(/visible-marker/g)).toHaveLength(1);
        expect(output.match(/"error":/g)).toHaveLength(1);
        expect(output.match(/data: \[DONE\]/g)).toHaveLength(1);
        expect(output).toContain('"code":502');
      } finally { reader.releaseLock(); }
      expect(attempts).toHaveLength(1);
      expect(onRequestSuccess).not.toHaveBeenCalled();
      expect(log.errorLine).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.stringContaining("UPSTREAM ERROR"));
      expect(saveRequestDetail).toHaveBeenLastCalledWith(expect.objectContaining({
        status: "interrupted",
        streamTelemetry: expect.objectContaining({ attemptCount: 1, phase: "committed" }),
      }));
    });
  });

  it("records a downstream cancellation without classifying it as an upstream error", async () => {
    await withUpstream((res) => { startSse(res); res.write(frame({ content: "visible-marker" })); }, async ({ attempts, abort, log, onRequestSuccess, run }) => {
      const { response } = await run();
      const reader = response.body.getReader();
      try {
        await readThrough(reader, "visible-marker");
        abort.abort();
        await expect(reader.read()).resolves.toMatchObject({ done: true });
      } finally { reader.releaseLock(); }
      expect(attempts).toHaveLength(1);
      expect(log.line).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.stringContaining("DOWNSTREAM CANCELLED"));
      expect(log.errorLine).not.toHaveBeenCalled();
      expect(onRequestSuccess).not.toHaveBeenCalled();
      expect(saveRequestDetail).toHaveBeenLastCalledWith(expect.objectContaining({
        status: "cancelled", streamTelemetry: expect.objectContaining({ phase: "downstream" }),
      }));
    });
  });
});
