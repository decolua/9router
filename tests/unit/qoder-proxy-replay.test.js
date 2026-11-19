import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/services/qoderModels.js", () => ({
  getQoderModelConfig: vi.fn(async () => ({ key: "auto", max_output_tokens: 32 })),
  resolveQoderModels: vi.fn(),
  isQoderPat: () => false,
  resolveQoderCredentials: vi.fn(),
}));

const request = {
  model: "auto",
  body: { messages: [{ role: "user", content: "hello" }], max_tokens: 32 },
  stream: true,
  credentials: {
    accessToken: "dt-test-token",
    providerSpecificData: { userId: "test-user", machineId: "test-machine" },
  },
};

const DONE_FRAME = 'data: {"statusCodeValue":200,"body":"[DONE]"}\n\n';
const directDispatch = vi.fn();
const proxyDispatch = vi.fn();

function success(body = DONE_FRAME) {
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function loadExecutor(fetchMock, useProxy = true) {
  vi.resetModules();
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]) {
    vi.stubEnv(key, "");
  }
  if (useProxy) vi.stubEnv("HTTPS_PROXY", "http://proxy.test:3128");
  // Exercise real proxy resolution and deadline forwarding with mocked network I/O.
  vi.stubGlobal("fetch", fetchMock);
  vi.doMock("undici", () => ({
    Agent: class { dispatch = directDispatch; },
    getGlobalDispatcher: () => ({ dispatch: directDispatch }),
    ProxyAgent: class { dispatch = proxyDispatch; },
    fetch: (url, options) => {
      options.dispatcher.dispatch({}, {});
      return fetchMock(url, options);
    },
  }));
  const { QoderExecutor } = await import("../../open-sse/executors/qoder.js");
  return new QoderExecutor();
}

afterEach(() => {
  vi.doUnmock("undici");
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Qoder signed inference transport", () => {
  it.each([null, { strictProxy: false }])("does not replay a signed POST after proxy response loss (%j)", async (proxyOptions) => {
    const seen = new Set();
    const fetchMock = vi.fn(async (_url, options) => {
      const authorization = options.headers.Authorization;
      if (seen.has(authorization)) {
        return new Response('data: {"statusCodeValue":403,"body":"{\\"code\\":\\"103\\",\\"message\\":\\"Duplicate request\\"}"}\n\n');
      }
      seen.add(authorization);
      throw new TypeError("response lost after upstream accepted request");
    });
    const executor = await loadExecutor(fetchMock);
    await expect(executor.execute({ ...request, proxyOptions })).rejects.toThrow("response lost");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(proxyDispatch).toHaveBeenCalledTimes(1);
    if (proxyOptions) expect(proxyOptions.strictProxy).toBe(false);
  });

  it("generates a fresh COSY identity when the caller retries after transport failure", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(success());
    const executor = await loadExecutor(fetchMock);
    await expect(executor.execute(request)).rejects.toThrow("response lost");
    const result = await executor.execute(request);
    expect(result.response.ok).toBe(true);
    await result.response.text();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const ids = fetchMock.mock.calls.map(([, options]) => JSON.parse(
      Buffer.from(options.headers.Authorization.split(".")[1], "base64").toString(),
    ).requestId);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it.each([true, false])("still supports successful inference with proxy=%s", async (useProxy) => {
    vi.stubEnv("STREAM_HEADERS_TIMEOUT_MS", undefined);
    const fetchMock = vi.fn(async () => success());
    const executor = await loadExecutor(fetchMock, useProxy);
    const result = await executor.execute(request);
    expect(result.response.ok).toBe(true);
    await result.response.text();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(proxyDispatch).toHaveBeenCalledTimes(useProxy ? 1 : 0);
    expect(directDispatch).toHaveBeenCalledTimes(useProxy ? 0 : 1);
    expect(useProxy ? proxyDispatch : directDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ headersTimeout: executor.config.timeoutMs }),
      {},
    );
  });

  it("aborts a signed attempt at the configured header deadline without proxy replay", async () => {
    vi.stubEnv("STREAM_HEADERS_TIMEOUT_MS", "100");
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    const fetchMock = vi.fn((_url, { signal }) => {
      markStarted(signal);
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    const executor = await loadExecutor(fetchMock);
    executor.config = { ...executor.config, timeoutMs: 25 };
    vi.useFakeTimers();
    const caller = new AbortController();
    const pending = executor.execute({ ...request, stream: false, signal: caller.signal });
    pending.catch(() => {});

    try {
      const signal = await Promise.race([started, pending]);
      await vi.advanceTimersByTimeAsync(99);
      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal.aborted).toBe(true);
      await expect(pending).rejects.toThrow(/timeout/i);
      expect(proxyDispatch).toHaveBeenCalledTimes(1);
      expect(directDispatch).not.toHaveBeenCalled();
    } finally {
      caller.abort();
      await pending.catch(() => {});
    }
  });

  it("uses streaming deadlines for aggregated calls and clears the watchdog at headers", async () => {
    vi.stubEnv("STREAM_HEADERS_TIMEOUT_MS", "100");
    vi.stubEnv("STREAM_FIRST_CHUNK_TIMEOUT_MS", "300");
    vi.stubEnv("STREAM_STALL_TIMEOUT_MS", "200");
    vi.stubEnv("STREAM_TERMINAL_GRACE_MS", "0");
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    const fetchMock = vi.fn(async (_url, options) => {
      markStarted(options.signal);
      await new Promise((resolve) => setTimeout(resolve, 75));
      return success(new ReadableStream({
        async start(controller) {
          await new Promise((resolve) => setTimeout(resolve, 125));
          controller.enqueue(new TextEncoder().encode(DONE_FRAME));
          controller.close();
        },
      }));
    });
    const executor = await loadExecutor(fetchMock, false);
    executor.config = { ...executor.config, timeoutMs: 25 };
    vi.useFakeTimers();

    const pending = executor.execute({ ...request, stream: false });
    pending.catch(() => {});
    const sentSignal = await Promise.race([started, pending]);
    await vi.advanceTimersByTimeAsync(200);
    const result = await pending;

    expect(sentSignal.aborted).toBe(false);
    expect(result.transformedBody.stream).toBe(true);
    expect(directDispatch).toHaveBeenCalledWith({ headersTimeout: 100, bodyTimeout: 300 }, {});
    await expect(result.response.text()).resolves.toContain("data: [DONE]");
  });

  it("preserves caller cancellation without replaying the request", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_url, options) => {
      controller.abort();
      throw options.signal.reason;
    });
    const executor = await loadExecutor(fetchMock);
    await expect(executor.execute({ ...request, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
