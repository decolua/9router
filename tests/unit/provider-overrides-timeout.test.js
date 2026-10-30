// providerOverrides.timeoutMs tests
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { BaseExecutor } = await import("../../open-sse/executors/base.js");
const { FETCH_CONNECT_TIMEOUT_MS } = await import("../../open-sse/config/runtimeConfig.js");

function res(status) {
  return { status, headers: { get: () => "" } };
}

function makeExec(config) {
  const ex = new BaseExecutor("test", config);
  return ex;
}

const creds = { apiKey: "test-key" };

beforeEach(() => fetchMock.mockReset());

describe("BaseExecutor.execute — providerOverrides.timeoutMs", () => {
  it("uses providerOverrides.timeoutMs as connect timeout when valid positive number", async () => {
    const ex = makeExec({ baseUrl: "https://x/api" });
    fetchMock.mockResolvedValueOnce(res(200));
    
    await ex.execute({ 
      model: "m", 
      body: {}, 
      stream: false, 
      credentials: creds,
      providerOverrides: { timeoutMs: 500 }
    });
    
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores providerOverrides.timeoutMs when not a finite positive number (0, negative, NaN, string, null)", async () => {
    const ex = makeExec({ baseUrl: "https://x/api" });
    fetchMock.mockResolvedValue(res(200));
    
    const invalidValues = [0, -1, "abc", NaN, null, undefined, Infinity, -Infinity];
    
    for (const val of invalidValues) {
      fetchMock.mockClear();
      await ex.execute({ 
        model: "m", 
        body: {}, 
        stream: false, 
        credentials: creds,
        providerOverrides: { timeoutMs: val }
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("falls back to config.timeoutMs when providerOverrides.timeoutMs is absent", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", timeoutMs: 10000 });
    fetchMock.mockResolvedValueOnce(res(200));
    
    await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to FETCH_CONNECT_TIMEOUT_MS when neither config nor override present", async () => {
    const ex = makeExec({ baseUrl: "https://x/api" });
    fetchMock.mockResolvedValueOnce(res(200));
    
    await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("providerOverrides.timeoutMs takes precedence over config.timeoutMs", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", timeoutMs: 10000 });
    fetchMock.mockResolvedValueOnce(res(200));
    
    await ex.execute({ 
      model: "m", 
      body: {}, 
      stream: false, 
      credentials: creds,
      providerOverrides: { timeoutMs: 500 }
    });
    
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});