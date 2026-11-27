import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { resetOpencodeTlsSession } from "../../open-sse/services/opencodeTlsClient.js";

const { nativeFetch } = vi.hoisted(() => ({ nativeFetch: vi.fn() }));

vi.mock("../../open-sse/services/lazyRuntime.js", () => ({
  loadRuntimeDep: async () => ({ createSession: async () => ({ fetch: nativeFetch }) }),
}));

function execute(model, stream, signal) {
  return new OpenCodeExecutor().execute({
    model,
    body: { model, messages: [{ role: "user", content: "hello" }], stream },
    stream,
    signal,
    credentials: {},
  });
}

// Model wreq's documented total-request timeout at the native boundary. The
// executor, proxy resolution, TLS adapter and Response/ReadableStream are real.
function liveResponse(options) {
  let controller;
  const body = new ReadableStream({ start(value) { controller = value; } });
  const timer = options.timeout > 0
    ? setTimeout(() => controller.error(new Error("native request timeout")), options.timeout)
    : null;
  options.signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    controller.error(options.signal.reason);
  }, { once: true });
  return {
    response: new Response(body, { headers: { "content-type": "text/event-stream" } }),
    send(text) { controller.enqueue(new TextEncoder().encode(text)); },
    finish() { clearTimeout(timer); controller.close(); },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("NO_PROXY", "*");
  vi.stubEnv("no_proxy", "*");
  nativeFetch.mockReset();
});

afterEach(() => {
  resetOpencodeTlsSession();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("OpenCode streaming timeout (#5334)", () => {
  it.each(["deepseek-v4.1-flash-free", "muse-spark-1.3-contributor-free", "union-alpha"])(
    "keeps %s streaming beyond 120 seconds without buffering",
    async (model) => {
      let upstream;
      nativeFetch.mockImplementation(async (_url, options) => {
        upstream = liveResponse(options);
        return upstream.response;
      });

      const { response } = await execute(model, true);
      const reader = response.body.getReader();
      upstream.send("data: first\n\n");
      expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: first\n\n");
      await vi.advanceTimersByTimeAsync(120001);
      upstream.send("data: later\n\n");
      expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: later\n\n");
      upstream.finish();
      expect((await reader.read()).done).toBe(true);
    }
  );

  it("retains the 120-second total timeout for non-streaming requests", async () => {
    nativeFetch.mockImplementation(async (_url, options) => liveResponse(options).response);
    const { response } = await execute("deepseek-v4.1-flash-free", false);
    const result = response.text();
    const failure = expect(result).rejects.toThrow("native request timeout");
    await vi.advanceTimersByTimeAsync(120000);
    await failure;
  });

  it("still cancels an active stream when the caller aborts", async () => {
    nativeFetch.mockImplementation(async (_url, options) => liveResponse(options).response);
    const controller = new AbortController();
    const { response } = await execute("deepseek-v4.1-flash-free", true, controller.signal);
    const result = response.body.getReader().read();
    const failure = expect(result).rejects.toThrow("client cancelled");
    controller.abort(new Error("client cancelled"));
    await failure;
  });

  it("still aborts when upstream never returns response headers", async () => {
    nativeFetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }));
    const executor = new OpenCodeExecutor();
    executor.config = { ...executor.config, timeoutMs: 10, retry: { 502: 0 } };
    const result = executor.execute({
      model: "deepseek-v4.1-flash-free",
      body: { messages: [{ role: "user", content: "hello" }], stream: true },
      stream: true,
      credentials: {},
    });
    const failure = expect(result).rejects.toThrow("fetch connect timeout");
    await vi.advanceTimersByTimeAsync(10);
    await failure;
  });
});
