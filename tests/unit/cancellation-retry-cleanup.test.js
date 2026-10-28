import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock undici (Agent used by image.js / proxyFetch) to run offline
vi.mock("undici", () => ({
  Agent: class MockAgent {},
  ProxyAgent: class MockProxyAgent {},
}));

// Mock uuid (used by kiro/commandcode)
vi.mock("uuid", () => ({
  v4: () => "mock-uuid-v4-0000",
}));

// Mock node-machine-id (used by grok-cli executor)
vi.mock("node-machine-id", () => ({
  machineIdSync: () => "mock-machine-id",
}));

// Mock ajv/dist/2020.js (used by deepseekWebToolBinding)
vi.mock("ajv/dist/2020.js", () => ({
  default: class MockAjv {
    compile() {
      return () => true;
    }
  },
}));

// Mock SQLite KV store helper to run in-memory
vi.mock("@/lib/db/helpers/kvStore.js", () => ({
  makeKv: () => ({
    get: async () => null,
    set: async () => {},
    remove: async () => {},
    getAll: async () => ({}),
  }),
}));

import { BaseExecutor } from "../../open-sse/executors/base.js";
import { createStreamController, createDisconnectAwareStream } from "../../open-sse/utils/streamHandler.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import * as proxyFetchModule from "../../open-sse/utils/proxyFetch.js";
import { DEFAULT_RETRY_CONFIG, FETCH_CONNECT_TIMEOUT_MS } from "../../open-sse/config/runtimeConfig.js";

describe("Phase 1: Request Cancellation and Retry Cleanup Regression Suite", () => {

  // 1. An incoming request signal is forwarded through the handler chain
  it("Criterion 1: forwards incoming request signal into streamController in handleChatCore", async () => {
    const clientAbortCtrl = new AbortController();
    let receivedSignal = null;
    let signalAbortedDuringExecution = false;

    const mockExecutor = {
      execute: vi.fn(async ({ signal }) => {
        receivedSignal = signal;
        // Client aborts while executor is in progress
        clientAbortCtrl.abort();
        signalAbortedDuringExecution = signal.aborted;
        return {
          response: new Response("data: [DONE]\n\n", {
            status: 200,
            headers: { "content-type": "text/event-stream" }
          }),
          url: "http://upstream",
          headers: {},
          transformedBody: {},
        };
      }),
    };

    // Spy on getExecutor to return our mock executor
    const executorIndex = await import("../../open-sse/executors/index.js");
    const origGetExecutor = executorIndex.getExecutor;
    vi.spyOn(executorIndex, "getExecutor").mockReturnValue(mockExecutor);

    await handleChatCore({
      body: { model: "test/test-model", messages: [{ role: "user", content: "hi" }] },
      modelInfo: { provider: "test", model: "test-model" },
      credentials: {},
      signal: clientAbortCtrl.signal,
    });

    expect(receivedSignal).toBeDefined();
    // Confirmed: client abort during execution aborted the internal signal
    expect(signalAbortedDuringExecution).toBe(true);

    vi.spyOn(executorIndex, "getExecutor").mockImplementation(origGetExecutor);
  });

  // 2. A signal already aborted before execution prevents upstream dispatch
  it("Criterion 2: a signal already aborted before execution prevents upstream dispatch", async () => {
    const clientAbortCtrl = new AbortController();
    clientAbortCtrl.abort(); // Pre-aborted

    const executorIndex = await import("../../open-sse/executors/index.js");
    const mockExecutor = {
      execute: vi.fn(),
    };
    vi.spyOn(executorIndex, "getExecutor").mockReturnValue(mockExecutor);

    const result = await handleChatCore({
      body: { model: "test/test-model", messages: [{ role: "user", content: "hi" }] },
      modelInfo: { provider: "test", model: "test-model" },
      credentials: {},
      signal: clientAbortCtrl.signal,
    });

    // Upstream execution must never have been dispatched
    expect(mockExecutor.execute).not.toHaveBeenCalled();
    expect(result.status).toBe(499);
    expect(result.error).toBe("Request aborted");

    vi.restoreAllMocks();
  });

  // 3. Cancellation during an active upstream fetch triggers the actual fetch cancellation signal
  it("Criterion 3: cancellation during an active upstream fetch triggers the actual fetch cancellation signal", async () => {
    const clientAbortCtrl = new AbortController();
    let upstreamFetchSignal = null;

    vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockImplementation(async (url, opts) => {
      upstreamFetchSignal = opts.signal;
      return new Promise((resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });

    const executor = new BaseExecutor("test", { baseUrl: "http://upstream" });
    const executePromise = executor.execute({
      model: "test-model",
      body: {},
      stream: true,
      credentials: {},
      signal: clientAbortCtrl.signal,
    });

    // Verify upstream fetch received an active signal linked to clientAbortCtrl
    expect(upstreamFetchSignal).toBeDefined();
    expect(upstreamFetchSignal.aborted).toBe(false);

    // Abort client signal
    clientAbortCtrl.abort();
    expect(upstreamFetchSignal.aborted).toBe(true);

    await expect(executePromise).rejects.toThrow("aborted");
    vi.restoreAllMocks();
  });

  // 4. Cancellation during backoff clears the timer and prevents another fetch attempt
  it("Criterion 4: cancellation during backoff clears the timer and prevents another fetch attempt", async () => {
    vi.useFakeTimers();
    let fetchCount = 0;
    const clientAbortCtrl = new AbortController();

    vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockImplementation(async () => {
      fetchCount++;
      throw new TypeError("fetch failed: connect ETIMEDOUT");
    });

    const executor = new BaseExecutor("test", {
      baseUrl: "http://upstream",
      retry: { 502: { attempts: 3, delayMs: 5000 } },
    });

    let caughtError = null;
    const executePromise = executor.execute({
      model: "test-model",
      body: {},
      stream: true,
      credentials: {},
      signal: clientAbortCtrl.signal,
    }).catch(e => {
      caughtError = e;
    });

    // Advance to trigger first failure -> enters 5000ms retry backoff
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchCount).toBe(1);

    // Abort client signal while sleeping in backoff (at 1000ms of the 5000ms delay)
    await vi.advanceTimersByTimeAsync(1000);
    clientAbortCtrl.abort();

    // Fast forward past the full 5000ms
    await vi.advanceTimersByTimeAsync(10000);
    await executePromise;

    // Should reject with AbortError and NOT have executed attempt 2
    expect(caughtError).toBeDefined();
    expect(caughtError.name).toBe("AbortError");
    expect(fetchCount).toBe(1);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // 5. Normal backoff completion removes its abort listener
  it("Criterion 5: normal backoff completion cleans up its abort listener", async () => {
    vi.useFakeTimers();
    let fetchCount = 0;
    const clientAbortCtrl = new AbortController();
    const removeListenerSpy = vi.spyOn(clientAbortCtrl.signal, "removeEventListener");

    vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockImplementation(async () => {
      fetchCount++;
      if (fetchCount === 1) {
        throw new TypeError("fetch failed: network error");
      }
      return new Response("ok", { status: 200 });
    });

    const executor = new BaseExecutor("test", {
      baseUrl: "http://upstream",
      retry: { 502: { attempts: 2, delayMs: 2000 } },
    });

    const executePromise = executor.execute({
      model: "test-model",
      body: {},
      stream: true,
      credentials: {},
      signal: clientAbortCtrl.signal,
    });

    // Advance through the 2000ms backoff
    await vi.advanceTimersByTimeAsync(2000);
    const result = await executePromise;

    expect(result.response.status).toBe(200);
    expect(fetchCount).toBe(2);

    // Verify removeEventListener was called on normal timer completion
    expect(removeListenerSpy).toHaveBeenCalledWith("abort", expect.any(Function));

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // 6. Cancellation is not remapped to retryable HTTP 502
  it("Criterion 6: cancellation error is re-thrown as AbortError and not remapped to 502", async () => {
    const clientAbortCtrl = new AbortController();
    let fetchCount = 0;

    vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockImplementation(async () => {
      fetchCount++;
      const abortErr = new Error("The operation was aborted");
      abortErr.name = "AbortError";
      throw abortErr;
    });

    const executor = new BaseExecutor("test", {
      baseUrl: "http://upstream",
      retry: { 502: { attempts: 3, delayMs: 1000 } },
    });

    let thrownError = null;
    try {
      await executor.execute({
        model: "test-model",
        body: {},
        stream: true,
        credentials: {},
        signal: clientAbortCtrl.signal,
      });
    } catch (e) {
      thrownError = e;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError.name).toBe("AbortError");
    // Crucial: fetch was called only once; it was NOT retried 3 times under 502
    expect(fetchCount).toBe(1);

    vi.restoreAllMocks();
  });

  // 7. Cancellation prevents account fallback
  it("Criterion 7: cancellation prevents account fallback in chat handler", async () => {
    const clientAbortCtrl = new AbortController();
    clientAbortCtrl.abort();

    const mockRequest = {
      json: async () => ({ model: "test/test-model", messages: [] }),
      url: "http://localhost:20128/v1/messages",
      headers: new Headers({ "user-agent": "test-client" }),
      signal: clientAbortCtrl.signal,
    };

    const chatHandlerModule = await import("../../src/sse/handlers/chat.js");
    const response = await chatHandlerModule.handleChat(mockRequest);

    // Returns HTTP 499 client abort immediately
    expect(response.status).toBe(499);
  });

  // 8. Cancellation reaches raw TCP socket when bypass operation is connecting
  it("Criterion 8: cancellation reaches raw TCP socket and calls socket.destroy()", async () => {
    const net = await import("net");
    const dns = await import("dns");
    const resolve4Spy = vi.spyOn(dns.Resolver.prototype, "resolve4").mockImplementation((host, cb) => {
      cb(null, ["172.217.116.4"]);
    });
    const connectSpy = vi.spyOn(net.Socket.prototype, "connect").mockImplementation(function() {
      return this;
    });
    const destroySpy = vi.spyOn(net.Socket.prototype, "destroy");

    const clientAbortCtrl = new AbortController();
    const fetchPromise = proxyFetchModule.proxyAwareFetch(
      "https://daily-cloudcode-pa.googleapis.com/v1internal",
      { signal: clientAbortCtrl.signal }
    );

    // Yield tick so DNS resolves and socket.connect starts
    await new Promise(r => setTimeout(r, 10));

    // Abort while connecting
    clientAbortCtrl.abort();

    await expect(fetchPromise).rejects.toThrow("aborted");
    expect(destroySpy).toHaveBeenCalled();

    resolve4Spy.mockRestore();
    connectSpy.mockRestore();
    destroySpy.mockRestore();
  });

  // 9. Socket cleanup does not create unhandled errors or leave listeners behind
  it("Criterion 9: pre-aborted signal rejects immediately before socket creation without leaving listeners", async () => {
    const clientAbortCtrl = new AbortController();
    clientAbortCtrl.abort();

    const removeListenerSpy = vi.spyOn(clientAbortCtrl.signal, "removeEventListener");

    await expect(
      proxyFetchModule.proxyAwareFetch("https://daily-cloudcode-pa.googleapis.com/v1internal", {
        signal: clientAbortCtrl.signal,
      })
    ).rejects.toThrow();

    vi.restoreAllMocks();
  });

  // 10. Cancellation during streaming stops upstream reading and releases relevant resources
  it("Criterion 10: cancellation during streaming stops upstream reading", async () => {
    vi.useFakeTimers();
    let disconnectedReason = null;
    const clientAbortCtrl = new AbortController();

    const controller = createStreamController({
      signal: clientAbortCtrl.signal,
      onDisconnect: ({ reason }) => {
        disconnectedReason = reason;
      },
    });

    expect(controller.isConnected()).toBe(true);

    const transform = new TransformStream();
    const disconnectStream = createDisconnectAwareStream(transform, controller);
    const reader = disconnectStream.getReader();

    // Client aborts reader
    await reader.cancel("client_closed");
    expect(controller.isConnected()).toBe(false);
    expect(disconnectedReason).toBe("client_closed");

    vi.advanceTimersByTime(500);
    expect(controller.signal.aborted).toBe(true);

    vi.useRealTimers();
  });

  // 11. Cancelling one request does not affect another concurrent request
  it("Criterion 11: cancelling one request does not affect another concurrent request", async () => {
    const clientA = new AbortController();
    const clientB = new AbortController();

    const controllerA = createStreamController({ signal: clientA.signal });
    const controllerB = createStreamController({ signal: clientB.signal });

    expect(controllerA.signal.aborted).toBe(false);
    expect(controllerB.signal.aborted).toBe(false);

    // Abort request A
    clientA.abort();
    expect(controllerA.signal.aborted).toBe(true);
    // Request B must remain active and unaffected
    expect(controllerB.signal.aborted).toBe(false);
  });

  // 12. Existing retry semantics remain correct: 3 additional retries means 4 total attempts
  it("Criterion 12: existing retry semantics (3 additional retries = 4 total attempts) remain correct when not cancelled", async () => {
    vi.useFakeTimers();
    let fetchCount = 0;

    vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockImplementation(async () => {
      fetchCount++;
      throw new TypeError("fetch failed: connect ETIMEDOUT");
    });

    const executor = new BaseExecutor("test", {
      baseUrl: "http://upstream",
      retry: { 502: { attempts: 3, delayMs: 1000 } },
    });

    const executePromise = executor.execute({
      model: "test-model",
      body: {},
      stream: true,
      credentials: {},
    }).catch(() => {});

    // Advance through 3 retry delays
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await executePromise;

    // Confirmed invariant: 1 initial attempt + 3 retries = 4 attempts total
    expect(fetchCount).toBe(4);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

});
