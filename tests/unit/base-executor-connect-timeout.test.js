// Locks the connect-timeout classification + retry policy in BaseExecutor.
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { BaseExecutor } = await import("../../open-sse/executors/base.js");

const creds = { apiKey: "k" };

// Upstream that never returns headers: settles ONLY when the merged abort signal
// fires (our connect timer). undici rejects with the abort REASON object, so
// error.name stays "Error" — the whole point of the closure-flag fix.
// base.js ALWAYS passes a signal (connectCtrl.signal, or AbortSignal.any([...])),
// so a call with no signal is a genuine anomaly — throw loudly instead of
// swallowing it, so a stray/background request would fail the test rather than hide.
function hangingFetch(url, opts) {
  const sig = opts?.signal;
  if (!sig) throw new Error("proxyAwareFetch called without a signal — base.js must always pass one");
  return new Promise((_resolve, reject) => {
    const onAbort = () => reject(sig.reason || new Error("aborted"));
    if (sig.aborted) return onAbort();
    sig.addEventListener("abort", onAbort, { once: true });
  });
}

// NOTE: block body (not `() => fetchMock.mockReset()`). mockReset() returns the
// mock, and an arrow that returns a function hands it to vitest as a teardown
// callback — vitest then invokes it after the test with zero args, producing a
// phantom no-signal fetch call during cleanup. Returning undefined avoids that.
beforeEach(() => { fetchMock.mockReset(); });

describe("BaseExecutor connect timeout", () => {
  it("classifies header-timeout via closure flag (NOT error.name); 0 in-place retries by default", async () => {
    fetchMock.mockImplementation(hangingFetch);
    const ex = new BaseExecutor("kr-ac", { baseUrl: "https://x/api", retry: {} });

    const err = await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: { providerId: "kr-ac", maxTransportAttempts: 2, skipRules: [], headerTimeoutMs: 40 },
    }).catch(e => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.errorKind).toBe("connect_timeout");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 8000);

  it("retries same account for connect_timeout when a retry rule matches", async () => {
    fetchMock.mockImplementation(hangingFetch);
    const ex = new BaseExecutor("kr-ac", { baseUrl: "https://x/api", retry: {} });

    const err = await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: {
        providerId: "kr-ac",
        maxTransportAttempts: 3,
        skipRules: [{ provider: "kr-ac", match: { kind: "connect_timeout" }, action: "retry" }],
        headerTimeoutMs: 25,
      },
    }).catch(e => e);

    expect(err.errorKind).toBe("connect_timeout");
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
  }, 8000);

  it("does not classify a real HTTP 502 as connect_timeout", async () => {
    fetchMock.mockResolvedValue({ status: 502, headers: { get: () => "" } });
    const ex = new BaseExecutor("kr-ac", { baseUrl: "https://x/api", retry: {} });

    const out = await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: { providerId: "kr-ac", maxTransportAttempts: 1, skipRules: [], headerTimeoutMs: 5000 },
    });
    expect(out.response.status).toBe(502);
  }, 8000);
});

// An HTTP error whose body carries text a `contains` rule matches. The mock's
// clone().text() returns that body; base.js must read it and drive retry policy.
function httpErrorWithBody(status, bodyText) {
  return () => Promise.resolve({
    status,
    headers: { get: () => "application/json" },
    clone: () => ({ text: () => Promise.resolve(bodyText) }),
  });
}

describe("BaseExecutor contains-rule drives transport retry", () => {
  it("action:retry on a matching body substring retries maxTransportAttempts-1 times", async () => {
    fetchMock.mockImplementation(httpErrorWithBody(500, '{"error":"Server OVERLOADED, try later"}'));
    const ex = new BaseExecutor("prov-x", { baseUrl: "https://x/api", retry: {} });

    const out = await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: {
        providerId: "prov-x",
        maxTransportAttempts: 3,
        skipRules: [{ provider: "prov-x", match: { contains: "overloaded" }, action: "retry" }],
      },
    });
    // 500 has no default retry entry, so WITHOUT the contains rule this would be 1 call.
    // The rule forces retry → 1 + 2 = 3 calls, then returns the last error response.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(out.response.status).toBe(500);
  }, 8000);

  it("action:skip on a matching body substring does NOT retry (0 in-place)", async () => {
    fetchMock.mockImplementation(httpErrorWithBody(500, "upstream is overloaded right now"));
    const ex = new BaseExecutor("prov-x", { baseUrl: "https://x/api", retry: {} });

    const out = await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: {
        providerId: "prov-x",
        maxTransportAttempts: 3,
        skipRules: [{ provider: "prov-x", match: { contains: "overloaded" }, action: "skip" }],
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1); // skip → jump to fallback, no in-place retry
    expect(out.response.status).toBe(500);
  }, 8000);

  it("does NOT read the body when no contains-rule applies to this provider", async () => {
    let cloned = 0;
    fetchMock.mockImplementation(() => Promise.resolve({
      status: 500,
      headers: { get: () => "application/json" },
      clone: () => { cloned++; return { text: () => Promise.resolve("overloaded") }; },
    }));
    const ex = new BaseExecutor("prov-y", { baseUrl: "https://x/api", retry: {} });

    await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: {
        providerId: "prov-y",
        maxTransportAttempts: 2,
        // contains rule is for a DIFFERENT provider → must not trigger a body read here
        skipRules: [{ provider: "other", match: { contains: "overloaded" }, action: "retry" }],
      },
    });
    expect(cloned).toBe(0);
  }, 8000);
});

describe("BaseExecutor error classification + policy isolation", () => {
  it("classifies a generic fetch failure (ECONNRESET) as network, not connect_timeout", async () => {
    fetchMock.mockImplementation(() => {
      const e = new Error("read ECONNRESET");
      e.code = "ECONNRESET";
      return Promise.reject(e);
    });
    const ex = new BaseExecutor("prov-x", { baseUrl: "https://x/api", retry: {} });

    const err = await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: { providerId: "prov-x", maxTransportAttempts: 1, skipRules: [], headerTimeoutMs: 5000 },
    }).catch(e => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.errorKind).toBe("network");
  }, 8000);

  it("two concurrent executes with different policies do not bleed timeouts/retries", async () => {
    // A: 30ms header timeout, no retry → 1 call, connect_timeout.
    // B: 200ms header timeout + retry rule maxTransportAttempts 3 → 3 calls, connect_timeout.
    // Shared singleton executor; policy must be per-call (never on this.config).
    fetchMock.mockImplementation(hangingFetch);
    const ex = new BaseExecutor("kr-ac", { baseUrl: "https://x/api", retry: {} });

    const callsBefore = () => fetchMock.mock.calls.length;
    const pA = ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: { providerId: "kr-ac", maxTransportAttempts: 2, skipRules: [], headerTimeoutMs: 30 },
    }).catch(e => e);
    const pB = ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: {
        providerId: "kr-ac",
        maxTransportAttempts: 3,
        skipRules: [{ provider: "kr-ac", match: { kind: "connect_timeout" }, action: "retry" }],
        headerTimeoutMs: 200,
      },
    }).catch(e => e);

    const [errA, errB] = await Promise.all([pA, pB]);
    expect(errA.errorKind).toBe("connect_timeout");
    expect(errB.errorKind).toBe("connect_timeout");
    // A: 1 call (no retry). B: 3 calls (1 + 2 retries). Total 4 — proves no cross-bleed.
    expect(callsBefore()).toBe(4);
  }, 8000);
});

describe("BaseExecutor skip-rule abandons account without cycling base URLs", () => {
  const THREE_URLS = ["https://a/api", "https://b/api", "https://c/api"];

  it("HTTP skip: does NOT cycle the remaining base URLs on the same account", async () => {
    // 429 that WITHOUT a skip rule would cycle all 3 URLs (shouldRetry on 429).
    fetchMock.mockImplementation(httpErrorWithBody(429, "rate limited"));
    const ex = new BaseExecutor("kr", { baseUrls: THREE_URLS, retry: {} });

    const out = await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: {
        providerId: "kr",
        maxTransportAttempts: 2,
        skipRules: [{ provider: "kr", match: { status: 429 }, action: "skip" }],
      },
    });
    expect(out.response.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1); // one URL only, then abandon account
  }, 8000);

  it("exception skip: does NOT cycle the remaining base URLs on the same account", async () => {
    // network error that WITHOUT a skip rule would fall through all 3 base URLs.
    fetchMock.mockImplementation(() => Promise.reject(new Error("read ECONNRESET")));
    const ex = new BaseExecutor("kr", { baseUrls: THREE_URLS, retry: {} });

    const err = await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: {
        providerId: "kr",
        maxTransportAttempts: 2,
        skipRules: [{ provider: "kr", match: { kind: "network" }, action: "skip" }],
      },
    }).catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.errorKind).toBe("network");
    expect(fetchMock).toHaveBeenCalledTimes(1); // abandoned after the first URL
  }, 8000);

  it("no skip rule → still cycles all base URLs (unchanged default behavior)", async () => {
    // Guards against over-reach: only a matched skip rule short-circuits URL cycling.
    fetchMock.mockImplementation(() => Promise.reject(new Error("read ECONNRESET")));
    const ex = new BaseExecutor("kr", { baseUrls: THREE_URLS, retry: {} });

    await ex.execute({
      model: "m", body: {}, stream: false, credentials: creds,
      requestPolicy: { providerId: "kr", maxTransportAttempts: 1, skipRules: [] },
    }).catch(e => e);
    expect(fetchMock).toHaveBeenCalledTimes(3); // all three URLs tried
  }, 8000);
});
