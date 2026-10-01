// Regression: usage/quota endpoints intermittently return 5xx. Without a retry,
// a single hiccup surfaces to the operator as a hard "quota API error (500)"
// even though the credential and request are fine. fetchWithRetry must retry
// transient 5xx and network errors, but NEVER retry a 4xx (a deterministic
// answer where a retry only wastes the provider's rate budget).
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Inject a controllable fetch via the global proxyAwareFetch delegate. The
// shared helper calls proxyAwareFetch from ../../utils/proxyFetch.js, so mock
// that module.
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { fetchWithRetry } from "../../open-sse/services/usage/shared.js";

const res = (status) => ({ status, ok: status >= 200 && status < 300 });

describe("fetchWithRetry", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("retries a 500 and returns the eventual success", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(res(500))
      .mockResolvedValueOnce(res(502))
      .mockResolvedValueOnce(res(200));
    const r = await fetchWithRetry("http://x", {}, { attempts: 3, backoffMs: 1 });
    expect(r.status).toBe(200);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry a 4xx", async () => {
    proxyAwareFetch.mockResolvedValue(res(401));
    const r = await fetchWithRetry("http://x", {}, { attempts: 3, backoffMs: 1 });
    expect(r.status).toBe(401);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("retries a network error, then throws after exhausting attempts", async () => {
    proxyAwareFetch.mockRejectedValue(new Error("ECONNRESET"));
    await expect(fetchWithRetry("http://x", {}, { attempts: 3, backoffMs: 1 })).rejects.toThrow("ECONNRESET");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
  });

  it("returns the last 5xx response (not throw) after exhausting attempts", async () => {
    proxyAwareFetch.mockResolvedValue(res(500));
    const r = await fetchWithRetry("http://x", {}, { attempts: 3, backoffMs: 1 });
    expect(r.status).toBe(500);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
  });

  it("returns immediately on a 2xx", async () => {
    proxyAwareFetch.mockResolvedValue(res(200));
    const r = await fetchWithRetry("http://x", {}, { attempts: 3, backoffMs: 1 });
    expect(r.status).toBe(200);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });
});
