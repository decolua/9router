// Locks BaseExecutor.execute retry/fallback behavior (docs 04 GAP #1, docs 11 §7).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the network layer so we can script upstream responses.
const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { BaseExecutor } = await import("../../open-sse/executors/base.js");

function res(status, body = "") {
  return {
    status,
    headers: { get: () => "" },
    text: async () => body,
    clone: () => ({ text: async () => body })
  };
}

function makeExec(config) {
  const ex = new BaseExecutor("test", config);
  // make headers trivial; credentials empty
  return ex;
}

const creds = { apiKey: "k" };

beforeEach(() => fetchMock.mockReset());
afterEach(() => vi.unstubAllEnvs());

describe("BaseExecutor.execute — retry by status (config-driven)", () => {
  it("returns ordinary validation errors without retrying by default", async () => {
    const ex = makeExec({ baseUrl: "https://x/api" });
    fetchMock.mockResolvedValueOnce(res(400, '{"error":{"message":"Malformed tool arguments"}}'));

    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });

    expect(out.response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("honors an explicit retry override for HTTP 400", async () => {
    vi.stubEnv("HTTP_400_RETRY_ATTEMPTS", "1");
    vi.stubEnv("HTTP_400_RETRY_DELAY_MS", "0");
    vi.resetModules();
    const { BaseExecutor: ConfiguredExecutor } = await import("../../open-sse/executors/base.js");
    const ex = new ConfiguredExecutor("test", { baseUrl: "https://x/api" });
    fetchMock.mockResolvedValueOnce(res(400)).mockResolvedValueOnce(res(200));

    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });

    expect(out.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns compressed-body 400 immediately for the Headroom fallback", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 400: { attempts: 1, delayMs: 0 } } });
    fetchMock.mockResolvedValueOnce(res(400));
    const out = await ex.execute({ model: "m", body: {}, stream: true, credentials: creds, skipBadRequestRetry: true });
    expect(out.response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("passes the configured streaming phase budgets to the transport without changing JSON calls", async () => {
    vi.stubEnv("STREAM_HEADERS_TIMEOUT_MS", "960000");
    vi.stubEnv("STREAM_FIRST_CHUNK_TIMEOUT_MS", "900000");
    vi.stubEnv("STREAM_STALL_TIMEOUT_MS", "360000");
    vi.stubEnv("STREAM_TERMINAL_GRACE_MS", "3000");
    vi.resetModules();
    const { BaseExecutor: ConfiguredExecutor } = await import("../../open-sse/executors/base.js");
    const executor = new ConfiguredExecutor("test", { baseUrl: "https://x/api", timeoutMs: 25 });
    fetchMock.mockImplementation(async () => res(200));

    await executor.execute({ model: "m", body: {}, stream: true, credentials: creds });
    await executor.execute({ model: "m", body: {}, stream: false, credentials: creds });

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ streamHeadersTimeoutMs: 960000, streamBodyTimeoutMs: 900000 });
    expect(fetchMock.mock.calls[1][1]).not.toHaveProperty("streamHeadersTimeoutMs");
    expect(fetchMock.mock.calls[1][1]).not.toHaveProperty("streamBodyTimeoutMs");
  });

  it("retries transient 500 UnknownError responses then succeeds", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 500: { attempts: 3, delayMs: 0 } } });
    const unknownError = JSON.stringify({ name: "UnknownError", data: { message: "\"Unknown Error\"" } });
    fetchMock
      .mockResolvedValueOnce(res(500, unknownError))
      .mockResolvedValueOnce(res(500, unknownError))
      .mockResolvedValueOnce(res(200));

    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });

    expect(out.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries 502 `attempts` times then succeeds", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 502: { attempts: 3, delayMs: 0 } } });
    fetchMock
      .mockResolvedValueOnce(res(502))
      .mockResolvedValueOnce(res(502))
      .mockResolvedValueOnce(res(200));
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops after exhausting 502 attempts on a single url and throws", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 502: { attempts: 2, delayMs: 0 } } });
    fetchMock.mockResolvedValue(res(502));
    // single url: 1 initial + 2 retries = 3 calls, then returns the 502 response (no fallback url)
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("BaseExecutor.execute — baseUrls fallback", () => {  it("falls over to the next url on 429 (shouldRetry)", async () => {
    const ex = makeExec({ baseUrls: ["https://a/api", "https://b/api"], retry: { 429: { attempts: 0 } } });
    fetchMock
      .mockResolvedValueOnce(res(429)) // url[0] → fallback
      .mockResolvedValueOnce(res(200)); // url[1] ok
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(200);
    expect(out.url).toBe("https://b/api");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("BaseExecutor.execute — network error retry/fallback", () => {
  it("maps network exception to 502 retry config", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 502: { attempts: 1, delayMs: 0 } } });
    fetchMock
      .mockImplementationOnce(async () => { throw new Error("ECONNRESET"); })
      .mockResolvedValueOnce(res(200));
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a transport abort only while the caller is still connected", async () => {
    const executor = makeExec({ baseUrl: "https://x/api", retry: { 502: { attempts: 1, delayMs: 0 } } });
    const client = new AbortController();
    const args = { model: "m", body: {}, stream: true, credentials: creds, signal: client.signal };
    fetchMock.mockRejectedValueOnce(new DOMException("Transport aborted", "AbortError")).mockResolvedValueOnce(res(200));

    await expect(executor.execute(args)).resolves.toMatchObject({ response: { status: 200 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][2]).toMatchObject({ forceFreshSocket: true });

    fetchMock.mockReset().mockImplementationOnce(async () => { client.abort(); throw client.signal.reason; });
    await expect(executor.execute(args)).rejects.toBe(client.signal.reason);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("throws when the only url fails with network error and no retries left", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 502: { attempts: 0 } } });
    // mockImplementationOnce (not persistent) avoids vitest flagging a reused rejection.
    fetchMock.mockImplementationOnce(async () => { throw new Error("boom"); });
    let thrown = null;
    try {
      await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    } catch (e) {
      thrown = e;
    }
    expect(thrown?.message).toBe("boom");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("BaseExecutor.execute — computeRetryDelay hook veto", () => {
  it("only invokes computeRetryDelay when status has retry config", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 503: { attempts: 1, delayMs: 0 } } });
    ex.computeRetryDelay = vi.fn().mockResolvedValue(0);
    fetchMock.mockResolvedValueOnce(res(418));
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(418);
    expect(ex.computeRetryDelay).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hook returning false skips retry (uses fallback path)", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 429: { attempts: 5, delayMs: 0 } } });
    ex.computeRetryDelay = vi.fn().mockResolvedValue(false);
    fetchMock.mockResolvedValueOnce(res(429));
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    // hook vetoes retry → no fallback url → returns the 429 response as-is
    expect(out.response.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
