// SEAT_ATTEMPT_BUDGET_MS tests
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { BaseExecutor } = await import("../../open-sse/executors/base.js");

function res(status) {
  return { status, headers: { get: () => "" } };
}

function makeExec(config) {
  const ex = new BaseExecutor("test", config);
  return ex;
}

const creds = { apiKey: "test-key" };

beforeEach(() => fetchMock.mockReset());

describe("BaseExecutor.execute — SEAT_ATTEMPT_BUDGET_MS", () => {
  it("limits retries when budget is exceeded (connect timeout path)", async () => {
    // Budget: 5000ms. Each attempt: 1000ms timeout + 3000ms delay = 4000ms
    // After 1st attempt (1000ms) + 3000ms delay = 4000ms, 2nd attempt would exceed 5000ms
    // So only 1 retry should happen before budget is exceeded
    const ex = makeExec({ 
      baseUrl: "https://x/api", 
      timeoutMs: 1000,
      retry: { 502: { attempts: 3, delayMs: 3000 } }
    });
    
    // Simulate connect timeouts (network errors mapped to 502)
    // Only mock 2 calls since budget should stop at 2
    fetchMock
      .mockRejectedValueOnce(new Error("connect timeout")) // attempt 1
      .mockRejectedValueOnce(new Error("connect timeout")); // attempt 2
    
    // With budget = 5000, we should not retry after the first attempt exceeds budget
    // Expected: 1 initial + 1 retry = 2 calls max (budget exceeded before 2nd retry)
    let thrown = null;
    try {
      await ex.execute({ 
        model: "m", 
        body: {}, 
        stream: false, 
        credentials: creds,
        providerOverrides: { seatBudgetMs: 5000 }
      });
    } catch (e) {
      thrown = e;
    }
    
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(thrown?.message).toBe("connect timeout");
  });

  it("does not limit retries when SEAT_ATTEMPT_BUDGET_MS = 0 (legacy behavior)", async () => {
    // When budget is 0 (disabled), all 3 retries should happen
    const ex = makeExec({ 
      baseUrl: "https://x/api", 
      timeoutMs: 1000,
      retry: { 502: { attempts: 3, delayMs: 0 } }
    });
    
    fetchMock
      .mockImplementationOnce(async () => { throw new Error("connect timeout"); })
      .mockImplementationOnce(async () => { throw new Error("connect timeout"); })
      .mockImplementationOnce(async () => { throw new Error("connect timeout"); })
      .mockResolvedValueOnce(res(200));
    
    const out = await ex.execute({ 
      model: "m", 
      body: {}, 
      stream: false, 
      credentials: creds,
    });
    
    expect(out.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it("happy path (200) is not affected by budget", async () => {
    const ex = makeExec({ baseUrl: "https://x/api" });
    fetchMock.mockResolvedValueOnce(res(200));
    
    const out = await ex.execute({ 
      model: "m", 
      body: {}, 
      stream: false, 
      credentials: creds,
      providerOverrides: { seatBudgetMs: 100 } // very low budget
    });
    
    expect(out.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("respects budget on 502 status retry path (not just connect timeout)", async () => {
      // Budget: 5000ms. 502 retry with 3000ms delay
      const ex = makeExec({ 
        baseUrl: "https://x/api", 
        retry: { 502: { attempts: 3, delayMs: 3000 } }
      });

      fetchMock
        .mockResolvedValueOnce(res(502)) // attempt 1
        .mockResolvedValueOnce(res(502)) // attempt 2 - should not happen if budget works
        .mockResolvedValueOnce(res(200));

      // When budget exceeded on 502 retry, it returns the 502 response (not throw)
      // because shouldRetry(502) returns false for single URL
      const out = await ex.execute({ 
        model: "m",
        body: {},
        stream: false,
        credentials: creds,
        providerOverrides: { seatBudgetMs: 5000 }
      });

      // Should only retry once before budget exceeded, then return 502
      expect(out.response.status).toBe(502);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("bounds in-flight connect attempt by seat budget (not just next retry)", async () => {
      // Budget 300ms, connect timeout 60s → abort should happen at ~300-800ms, never near 60s
      const ex = makeExec({ 
        baseUrl: "https://x/api", 
        timeoutMs: 60000 // 60s connect timeout
      });

      // Simulate a slow connect that would take >60s without budget bound
      // The mock must respect the abort signal
      let abortController = null;
      fetchMock.mockImplementationOnce((url, options) => {
        abortController = options.signal;
        return new Promise((resolve, reject) => {
          const onAbort = () => reject(new DOMException("aborted", "AbortError"));
          if (abortController.aborted) onAbort();
          else abortController.addEventListener("abort", onAbort, { once: true });
          // Never resolve - simulates infinite hang
        });
      });

      const start = Date.now();
      let thrown = null;
      try {
        await ex.execute({
          model: "m",
          body: {},
          stream: false,
          credentials: creds,
          providerOverrides: { seatBudgetMs: 300 }
        });
      } catch (e) {
        thrown = e;
      }
      const elapsed = Date.now() - start;

      // Should abort due to budget (~300ms), not connect timeout (60s)
      expect(elapsed).toBeLessThan(1500); // generous upper bound
      expect(elapsed).toBeGreaterThan(200); // should respect budget
      expect(thrown?.name).toBe("AbortError");
      expect(fetchMock).toHaveBeenCalledTimes(1); // only one attempt, no retry
    });
  });