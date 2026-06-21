// Locks BaseExecutor.execute retry/fallback behavior (docs 04 GAP #1, docs 11 §7).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the network layer so we can script upstream responses.
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
	// make headers trivial; credentials empty
	return ex;
}

const creds = { apiKey: "k" };

beforeEach(() => fetchMock.mockReset());

describe("BaseExecutor.execute — retry by status (config-driven)", () => {
	it("retries 502 `attempts` times then succeeds", async () => {
		const ex = makeExec({
			baseUrl: "https://x/api",
			retry: { 502: { attempts: 3, delayMs: 0 } },
		});
		fetchMock
			.mockResolvedValueOnce(res(502))
			.mockResolvedValueOnce(res(502))
			.mockResolvedValueOnce(res(200));
		const out = await ex.execute({
			model: "m",
			body: {},
			stream: false,
			credentials: creds,
		});
		expect(out.response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("stops after exhausting 502 attempts on a single url and throws", async () => {
		const ex = makeExec({
			baseUrl: "https://x/api",
			retry: { 502: { attempts: 2, delayMs: 0 } },
		});
		fetchMock.mockResolvedValue(res(502));
		// single url: 1 initial + 2 retries = 3 calls, then returns the 502 response (no fallback url)
		const out = await ex.execute({
			model: "m",
			body: {},
			stream: false,
			credentials: creds,
		});
		expect(out.response.status).toBe(502);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
});

describe("BaseExecutor.execute — baseUrls fallback", () => {
	it("falls over to the next url on 429 (shouldRetry)", async () => {
		const ex = makeExec({
			baseUrls: ["https://a/api", "https://b/api"],
			retry: { 429: { attempts: 0 } },
		});
		fetchMock
			.mockResolvedValueOnce(res(429)) // url[0] → fallback
			.mockResolvedValueOnce(res(200)); // url[1] ok
		const out = await ex.execute({
			model: "m",
			body: {},
			stream: false,
			credentials: creds,
		});
		expect(out.response.status).toBe(200);
		expect(out.url).toBe("https://b/api");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

describe("BaseExecutor.execute — network error retry/fallback", () => {
	it("maps network exception to 502 retry config", async () => {
		const ex = makeExec({
			baseUrl: "https://x/api",
			retry: { 502: { attempts: 1, delayMs: 0 } },
		});
		fetchMock
			.mockImplementationOnce(async () => {
				throw new Error("ECONNRESET");
			})
			.mockResolvedValueOnce(res(200));
		const out = await ex.execute({
			model: "m",
			body: {},
			stream: false,
			credentials: creds,
		});
		expect(out.response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("throws when the only url fails with network error and no retries left", async () => {
		const ex = makeExec({
			baseUrl: "https://x/api",
			retry: { 502: { attempts: 0 } },
		});
		// mockImplementationOnce (not persistent) avoids vitest flagging a reused rejection.
		fetchMock.mockImplementationOnce(async () => {
			throw new Error("boom");
		});
		let thrown = null;
		try {
			await ex.execute({
				model: "m",
				body: {},
				stream: false,
				credentials: creds,
			});
		} catch (e) {
			thrown = e;
		}
		expect(thrown?.message).toBe("boom");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe("BaseExecutor.execute — computeRetryDelay hook veto", () => {
	it("hook returning false skips retry (uses fallback path)", async () => {
		const ex = makeExec({
			baseUrl: "https://x/api",
			retry: { 429: { attempts: 5, delayMs: 0 } },
		});
		ex.computeRetryDelay = vi.fn().mockResolvedValue(false);
		fetchMock.mockResolvedValueOnce(res(429));
		const out = await ex.execute({
			model: "m",
			body: {},
			stream: false,
			credentials: creds,
		});
		// hook vetoes retry → no fallback url → returns the 429 response as-is
		expect(out.response.status).toBe(429);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe("BaseExecutor.execute — exponential backoff + full jitter (injectable rng)", () => {
	it("rng=0 collapses full-jitter waits to 0ms — retry exhausts attempts quickly", async () => {
		// exp attempt 1 → cap 5000, jitter(rng=0) → 0. Repeat 3 times.
		const ex = makeExec({
			baseUrl: "https://x/api",
			retry: {
				502: {
					attempts: 3,
					delayMs: 5000,
					backoff: "exp",
					maxDelayMs: 5000,
					jitter: true,
				},
			},
			rng: () => 0,
		});
		fetchMock.mockResolvedValue(res(502));
		const start = Date.now();
		const out = await ex.execute({
			model: "m",
			body: {},
			stream: false,
			credentials: creds,
		});
		const elapsed = Date.now() - start;
		expect(out.response.status).toBe(502);
		// 1 initial + 3 retries = 4 calls (no fallback URL → returns 502 after exhausting).
		expect(fetchMock).toHaveBeenCalledTimes(4);
		// All waits zeroed by rng=0 → no real backoff delay accumulated.
		expect(elapsed).toBeLessThan(500);
	});

	it("without rng (default Math.random), retry still exhausts — call count matches attempts+1", async () => {
		const ex = makeExec({
			baseUrl: "https://x/api",
			retry: {
				502: {
					attempts: 2,
					delayMs: 0,
					backoff: "fixed",
					maxDelayMs: 0,
					jitter: false,
				},
			},
			// rng intentionally absent: Math.random should not crash the loop.
		});
		fetchMock.mockResolvedValue(res(502));
		const out = await ex.execute({
			model: "m",
			body: {},
			stream: false,
			credentials: creds,
		});
		expect(out.response.status).toBe(502);
		expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
	});

	it("deterministic retry path uses computeBackoffDelay for exp+jitter (call count matches attempts+1)", async () => {
		// With rng=0, even a large baseDelayMs is zeroed. Verify the loop honors
		// attempts regardless of the would-be backoff magnitude.
		const ex = makeExec({
			baseUrl: "https://x/api",
			retry: {
				502: {
					attempts: 5,
					delayMs: 60000,
					backoff: "exp",
					maxDelayMs: 60000,
					jitter: true,
				},
			},
			rng: () => 0,
		});
		fetchMock.mockResolvedValue(res(502));
		const start = Date.now();
		const out = await ex.execute({
			model: "m",
			body: {},
			stream: false,
			credentials: creds,
		});
		const elapsed = Date.now() - start;
		expect(out.response.status).toBe(502);
		expect(fetchMock).toHaveBeenCalledTimes(6); // 1 initial + 5 retries
		// 6 iterations of zero-jitter waits must finish far under the un-jittered budget
		// (which would have been 60s + 120s + ... over 3 minutes).
		expect(elapsed).toBeLessThan(1000);
	});
});

describe("BaseExecutor.execute — RETRY_MAX_ELAPSED_MS self-contained cap", () => {
	const ORIG_RETRY_MAX_ELAPSED = process.env.RETRY_MAX_ELAPSED_MS;

	afterEach(() => {
		if (ORIG_RETRY_MAX_ELAPSED === undefined) {
			delete process.env.RETRY_MAX_ELAPSED_MS;
		} else {
			process.env.RETRY_MAX_ELAPSED_MS = ORIG_RETRY_MAX_ELAPSED;
		}
		// Drop the module we re-imported with the test env so the next test sees
		// the original module again.
		vi.resetModules();
	});

	async function freshBaseExecutor() {
		vi.resetModules();
		return await import("../../open-sse/executors/base.js");
	}

	it("vetoes retry once cumulative wait would exceed RETRY_MAX_ELAPSED_MS", async () => {
		// Cap=50ms, per-retry=30ms (no jitter). 1st retry: 0+30=30 ≤ 50 → allow.
		// 2nd retry: 30+30=60 > 50 → veto. Total fetch count = 1 + 1 = 2.
		process.env.RETRY_MAX_ELAPSED_MS = "50";
		const { BaseExecutor: FreshBE } = await freshBaseExecutor();
		const ex = new FreshBE("test", {
			baseUrl: "https://x/api",
			retry: {
				502: {
					attempts: 100,
					delayMs: 30,
					backoff: "fixed",
					maxDelayMs: 30,
					jitter: false,
				},
			},
			rng: () => 0,
		});
		fetchMock.mockResolvedValue(res(502));
		const out = await ex.execute({
			model: "m",
			body: {},
			stream: false,
			credentials: creds,
		});
		expect(out.response.status).toBe(502);
		// 1 initial + 1 retry (cumulative 30ms) → 2nd retry vetoed (would push to 60ms > 50).
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("vetoes immediately when delayMs alone exceeds RETRY_MAX_ELAPSED_MS", async () => {
		// Cap=10ms, per-retry=100ms. Even the first retry would push cumulative to > cap → veto.
		// Total fetch count = 1 (initial only, no retry).
		process.env.RETRY_MAX_ELAPSED_MS = "10";
		const { BaseExecutor: FreshBE } = await freshBaseExecutor();
		const ex = new FreshBE("test", {
			baseUrl: "https://x/api",
			retry: {
				502: {
					attempts: 5,
					delayMs: 100,
					backoff: "fixed",
					maxDelayMs: 100,
					jitter: false,
				},
			},
			rng: () => 0,
		});
		fetchMock.mockResolvedValue(res(502));
		const out = await ex.execute({
			model: "m",
			body: {},
			stream: false,
			credentials: creds,
		});
		expect(out.response.status).toBe(502);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("cap is independent of fetch connect timeout (no derivation from this.config.timeoutMs)", async () => {
		// 300ms cap; tiny connect timeout — cap must still be the env-bound value.
		process.env.RETRY_MAX_ELAPSED_MS = "300";
		const { BaseExecutor: FreshBE } = await freshBaseExecutor();
		const ex = new FreshBE("test", {
			baseUrl: "https://x/api",
			timeoutMs: 5, // connect timeout — irrelevant to retry cap
			retry: {
				502: {
					attempts: 100,
					delayMs: 50,
					backoff: "fixed",
					maxDelayMs: 50,
					jitter: false,
				},
			},
			rng: () => 0,
		});
		fetchMock.mockResolvedValue(res(502));
		const out = await ex.execute({
			model: "m",
			body: {},
			stream: false,
			credentials: creds,
		});
		expect(out.response.status).toBe(502);
		// cap=300, per-retry=50, jitter=0: cumulative waits 50,100,150,200,250 → 5 retries fit.
		// 6th would be 250+50=300 (at boundary, vetoed by any non-zero overhead) — we accept
		// either 6 or 7 fetches, both confirm the cap stops retries early vs. attempts=100.
		expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(6);
		expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(7);
	});
});

describe("BaseExecutor.execute — default retry policy (DEFAULT_RETRY_CONFIG)", () => {
	it("429 default policy has attempts=0 (no retries, falls through to shouldRetry fallback)", async () => {
		const ex = makeExec({
			baseUrls: ["https://a/api", "https://b/api"],
			// No retry override — uses DEFAULT_RETRY_CONFIG[429] = { attempts: 0 }
		});
		fetchMock
			.mockResolvedValueOnce(res(429)) // url[0] → fallback (429 has 0 attempts)
			.mockResolvedValueOnce(res(200)); // url[1] ok
		const out = await ex.execute({
			model: "m",
			body: {},
			stream: false,
			credentials: creds,
		});
		expect(out.response.status).toBe(200);
		expect(out.url).toBe("https://b/api");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("502 default policy uses exp backoff + jitter (3 attempts)", async () => {
		// Default 502: { attempts: 3, delayMs: 1000, backoff: "exp", maxDelayMs: 8000, jitter: true }
		const ex = makeExec({
			baseUrl: "https://x/api",
			// No retry override — uses DEFAULT_RETRY_CONFIG[502]
			rng: () => 0, // zero jitter for deterministic timing
		});
		fetchMock.mockResolvedValue(res(502));
		const start = Date.now();
		const out = await ex.execute({
			model: "m",
			body: {},
			stream: false,
			credentials: creds,
		});
		const elapsed = Date.now() - start;
		expect(out.response.status).toBe(502);
		// 1 initial + 3 retries = 4 calls
		expect(fetchMock).toHaveBeenCalledTimes(4);
		// All waits zeroed by rng=0 → no real backoff delay
		expect(elapsed).toBeLessThan(500);
	});

	it("503 default policy uses exp backoff + jitter (3 attempts, maxDelayMs 8000)", async () => {
		// Default 503: { attempts: 3, delayMs: 1000, backoff: "exp", maxDelayMs: 8000, jitter: true }
		const ex = makeExec({
			baseUrl: "https://x/api",
			// No retry override — uses DEFAULT_RETRY_CONFIG[503]
			rng: () => 0,
		});
		fetchMock.mockResolvedValue(res(503));
		const out = await ex.execute({
			model: "m",
			body: {},
			stream: false,
			credentials: creds,
		});
		expect(out.response.status).toBe(503);
		expect(fetchMock).toHaveBeenCalledTimes(4); // 1 + 3
	});

	it("504 default policy uses exp backoff + jitter (2 attempts, maxDelayMs 4000)", async () => {
		// Default 504: { attempts: 2, delayMs: 1000, backoff: "exp", maxDelayMs: 4000, jitter: true }
		const ex = makeExec({
			baseUrl: "https://x/api",
			// No retry override — uses DEFAULT_RETRY_CONFIG[504]
			rng: () => 0,
		});
		fetchMock.mockResolvedValue(res(504));
		const out = await ex.execute({
			model: "m",
			body: {},
			stream: false,
			credentials: creds,
		});
		expect(out.response.status).toBe(504);
		expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2
	});

	it("provider config merges over DEFAULT_RETRY_CONFIG (override only what is specified)", async () => {
		// Provider adds 429 retries; 502/503/504 remain from DEFAULT_RETRY_CONFIG
		const ex = makeExec({
			baseUrl: "https://x/api",
			retry: {
				429: { attempts: 2, delayMs: 100, backoff: "fixed", jitter: false },
			},
			rng: () => 0,
		});
		fetchMock
			.mockResolvedValueOnce(res(429)) // 429 → retry
			.mockResolvedValueOnce(res(200)); // success
		const out = await ex.execute({
			model: "m",
			body: {},
			stream: false,
			credentials: creds,
		});
		expect(out.response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

describe("BaseExecutor.execute — computeRetryDelay hook null/undefined fallthrough", () => {
	it("hook returning null falls through to base computeBackoffDelay (no jitter)", async () => {
		vi.useFakeTimers();
		try {
			const ex = makeExec({
				baseUrl: "https://x/api",
				retry: {
					429: { attempts: 1, delayMs: 100, backoff: "fixed", jitter: false },
				},
			});
			ex.computeRetryDelay = vi.fn().mockResolvedValue(null); // explicit null → fallthrough
			fetchMock.mockResolvedValueOnce(res(429)).mockResolvedValueOnce(res(200)); // second call succeeds
			const promise = ex.execute({
				model: "m",
				body: {},
				stream: false,
				credentials: creds,
			});
			await vi.advanceTimersByTimeAsync(0);
			expect(fetchMock).toHaveBeenCalledTimes(1); // initial 429 fetch done
			// Before the base 100ms delay, the retry must not have fired yet.
			await vi.advanceTimersByTimeAsync(99);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			// At exactly 100ms the retry fetch fires.
			await vi.advanceTimersByTimeAsync(1);
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(ex.computeRetryDelay).toHaveBeenCalledTimes(1);
			const out = await promise;
			expect(out.response.status).toBe(200);
		} finally {
			vi.useRealTimers();
		}
	});

	it("hook returning undefined also falls through (distinct from missing hook)", async () => {
		const ex = makeExec({
			baseUrl: "https://x/api",
			retry: {
				429: { attempts: 1, delayMs: 50, backoff: "fixed", jitter: false },
			},
		});
		ex.computeRetryDelay = vi.fn().mockResolvedValue(undefined); // undefined
		fetchMock.mockResolvedValue(res(429));
		const out = await ex.execute({
			model: "m",
			body: {},
			stream: false,
			credentials: creds,
		});
		expect(out.response.status).toBe(429);
		expect(ex.computeRetryDelay).toHaveBeenCalledTimes(1);
		// 1 initial + 1 retry = 2 calls (base delay used because hook returned undefined)
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("hook not defined on executor → skip hook entirely (base only)", async () => {
		// BaseExecutor has no computeRetryDelay; ensure it doesn't crash
		const ex = makeExec({
			baseUrl: "https://x/api",
			retry: {
				502: { attempts: 1, delayMs: 50, backoff: "fixed", jitter: false },
			},
		});
		// No computeRetryDelay defined
		fetchMock.mockResolvedValue(res(502));
		const out = await ex.execute({
			model: "m",
			body: {},
			stream: false,
			credentials: creds,
		});
		expect(out.response.status).toBe(502);
		expect(fetchMock).toHaveBeenCalledTimes(2); // 1 + 1 retry
	});
});

describe("BaseExecutor.execute — abort during retry sleep", () => {
	it("abort during retry sleep prevents further fetch and exits via abort path (fake timers)", async () => {
		vi.useFakeTimers();
		try {
			const ctrl = new AbortController();
			const ex = makeExec({
				baseUrl: "https://x/api",
				// delayMs is under the default RETRY_MAX_ELAPSED_MS so the cap doesn't
				// veto before the sleep starts.
				retry: {
					502: {
						attempts: 5,
						delayMs: 1000,
						backoff: "fixed",
						maxDelayMs: 1000,
						jitter: false,
					},
				},
			});
			// First fetch fails → a 1000ms retry sleep is scheduled.
			fetchMock.mockResolvedValueOnce(res(502));

			const promise = ex.execute({
				model: "m",
				body: {},
				stream: false,
				credentials: creds,
				signal: ctrl.signal,
			});
			// Attach rejection handler up front so aborting the in-flight sleep does
			// not produce an asynchronously-handled promise rejection warning.
			const rejection = expect(promise).rejects.toThrow(/aborted|AbortError/i);

			// Let the initial fetch complete and the retry sleep start.
			await vi.advanceTimersByTimeAsync(0);
			expect(fetchMock).toHaveBeenCalledTimes(1); // initial fetch done, retry sleeping

			// Before the expected delay, no retry fetch has happened yet.
			await vi.advanceTimersByTimeAsync(500);
			expect(fetchMock).toHaveBeenCalledTimes(1); // still sleeping

			// Abort while the retry is sleeping.
			ctrl.abort();

			// Advance timers far past the retry delay — no further fetch should occur
			// because the sleep was aborted.
			await vi.advanceTimersByTimeAsync(2000);

			await rejection;
			expect(fetchMock).toHaveBeenCalledTimes(1); // second fetch prevented
		} finally {
			vi.useRealTimers();
		}
	});

	it("pre-aborted signal prevents retry sleep entirely (no real sleep)", async () => {
		const ctrl = new AbortController();
		ctrl.abort();
		const ex = makeExec({
			baseUrl: "https://x/api",
			// delayMs is under the default RETRY_MAX_ELAPSED_MS so the cap doesn't
			// veto before sleepWithAbort sees the aborted signal.
			retry: {
				502: {
					attempts: 5,
					delayMs: 1000,
					backoff: "fixed",
					maxDelayMs: 1000,
					jitter: false,
				},
			},
		});
		fetchMock.mockResolvedValueOnce(res(502));

		const start = Date.now();
		let thrown = null;
		try {
			await ex.execute({
				model: "m",
				body: {},
				stream: false,
				credentials: creds,
				signal: ctrl.signal,
			});
		} catch (e) {
			thrown = e;
		}

		expect(thrown?.name).toBe("AbortError");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(Date.now() - start).toBeLessThan(100); // no 1s sleep
	});
});
