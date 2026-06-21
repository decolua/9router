// Guards D3: antigravity 429/503 retry merged into base via computeRetryDelay hook.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { BaseExecutor } from "../../open-sse/executors/base.js";

// Mock the network layer so BaseExecutor.execute integration tests can script
// upstream responses without touching the real fetch stack.
const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
	proxyAwareFetch: (...args) => fetchMock(...args),
}));

const MAX = 10000;
function res(status, headers = {}, body = null) {
	return {
		status,
		headers: { get: (k) => headers[k.toLowerCase()] ?? null },
		clone: () => ({
			text: async () => (body == null ? "" : JSON.stringify(body)),
		}),
	};
}

const creds = { accessToken: "tok" };

beforeEach(() => fetchMock.mockReset());

describe("antigravity computeRetryDelay hook (D3)", () => {
	const ag = new AntigravityExecutor();

	it("uses Retry-After header (seconds → ms) when within cap", async () => {
		expect(
			await ag.computeRetryDelay(res(429, { "retry-after": "5" }), 1),
		).toBe(5000);
	});

	it("vetoes (false) when Retry-After exceeds cap", async () => {
		expect(
			await ag.computeRetryDelay(res(429, { "retry-after": "60" }), 1),
		).toBe(false);
	});

	it("parses retry time from error body when no header", async () => {
		const r = res(429, {}, { error: { message: "quota will reset after 3s" } });
		expect(await ag.computeRetryDelay(r, 1)).toBe(3000);
	});

	it("exponential backoff for 429 when no retry info", async () => {
		expect(await ag.computeRetryDelay(res(429), 1)).toBe(
			Math.min(1000 * 2 ** 1, MAX),
		);
		expect(await ag.computeRetryDelay(res(429), 3)).toBe(
			Math.min(1000 * 2 ** 3, MAX),
		);
	});

	it("503 without retry info → veto (no auto backoff)", async () => {
		expect(await ag.computeRetryDelay(res(503), 1)).toBe(false);
	});

	it("buildHeaders includes cached session id after transformRequest", () => {
		ag._lastSessionId = "sess-123";
		const h = ag.buildHeaders({ accessToken: "tok" }, true);
		expect(h["X-Machine-Session-Id"]).toBe("sess-123");
	});
});

// Integration tests: confirm the antigravity subclass hook still wins over
// BaseExecutor's new computeBackoffDelay machinery. These run the full
// BaseExecutor.execute retry path so we catch regressions where the hook
// precedence or veto contract could be silently dropped.
describe("subclass hook override/veto wins over base computeBackoffDelay", () => {
	const ag = new AntigravityExecutor();

	it("hook override (antigravity's Retry-After header) wins over base backoff (fake timers)", async () => {
		// Base retry config would produce a 10000ms exp+jitter delay (rng=1 → cap).
		// Antigravity's hook reads Retry-After: 1 → 1000ms which must win.
		vi.useFakeTimers();
		try {
			const ex = new BaseExecutor("test", {
				baseUrl: "https://x/api",
				retry: {
					429: {
						attempts: 5,
						delayMs: 10000,
						backoff: "exp",
						maxDelayMs: 10000,
						jitter: true,
					},
				},
				rng: () => 1, // base would yield 10000ms wait
			});
			ex.computeRetryDelay = ag.computeRetryDelay.bind(ag);

			// Retry-After: 1 → 1000ms (parses as integer seconds).
			fetchMock
				.mockResolvedValueOnce(res(429, { "retry-after": "1" }))
				.mockResolvedValueOnce(res(200));

			const promise = ex.execute({
				model: "m",
				body: {},
				stream: false,
				credentials: creds,
			});

			await vi.advanceTimersByTimeAsync(0);
			expect(fetchMock).toHaveBeenCalledTimes(1); // initial 429 fetch done

			// Before the hook's 1000ms delay, the retry must not have fired yet.
			await vi.advanceTimersByTimeAsync(999);
			expect(fetchMock).toHaveBeenCalledTimes(1);

			// At exactly 1000ms the retry fetch fires (hook value wins over base 10000ms).
			await vi.advanceTimersByTimeAsync(1);
			expect(fetchMock).toHaveBeenCalledTimes(2);

			const out = await promise;
			expect(out.response.status).toBe(200);
		} finally {
			vi.useRealTimers();
		}
	});

	it("hook veto (antigravity returns false for 503 without retry info) wins", async () => {
		// 503 from antigravity hook returns false (no auto backoff per D3 contract).
		// Even with high base retry config, the veto must skip the retry entirely.
		const ex = new BaseExecutor("test", {
			baseUrl: "https://x/api",
			retry: {
				503: {
					attempts: 5,
					delayMs: 5000,
					backoff: "exp",
					maxDelayMs: 5000,
					jitter: true,
				},
			},
			rng: () => 1, // would normally produce 5000ms wait if it ran
		});
		ex.computeRetryDelay = ag.computeRetryDelay.bind(ag);

		fetchMock.mockResolvedValueOnce(res(503));
		const start = Date.now();
		const out = await ex.execute({
			model: "m",
			body: {},
			stream: false,
			credentials: creds,
		});
		const elapsed = Date.now() - start;

		expect(out.response.status).toBe(503);
		expect(fetchMock).toHaveBeenCalledTimes(1); // veto → no retry
		expect(elapsed).toBeLessThan(500); // no sleep
	});

	it("hook return value larger than base exp cap — hook still wins (fake timers)", async () => {
		// Use a spy hook to control the returned value precisely. Base would yield
		// 10ms (delayMs=10, exp+jitter, rng=1 → cap=10). Hook returns 300ms which wins.
		vi.useFakeTimers();
		try {
			const ex = new BaseExecutor("test", {
				baseUrl: "https://x/api",
				retry: {
					429: {
						attempts: 3,
						delayMs: 10,
						backoff: "exp",
						maxDelayMs: 10,
						jitter: true,
					},
				},
				rng: () => 1, // base would yield 10ms
			});
			const hookSpy = vi.fn().mockResolvedValue(300);
			ex.computeRetryDelay = hookSpy;

			fetchMock
				.mockResolvedValueOnce(res(429, {}))
				.mockResolvedValueOnce(res(200));

			const promise = ex.execute({
				model: "m",
				body: {},
				stream: false,
				credentials: creds,
			});

			await vi.advanceTimersByTimeAsync(0);
			expect(fetchMock).toHaveBeenCalledTimes(1);

			// Before the hook's 300ms delay, the retry must not have fired yet.
			await vi.advanceTimersByTimeAsync(299);
			expect(fetchMock).toHaveBeenCalledTimes(1);

			// At exactly 300ms the retry fetch fires (hook value wins over base 10ms).
			await vi.advanceTimersByTimeAsync(1);
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(hookSpy).toHaveBeenCalledTimes(1);

			const out = await promise;
			expect(out.response.status).toBe(200);
		} finally {
			vi.useRealTimers();
		}
	});

	it("hook returning null falls through to base computeBackoffDelay (fake timers)", async () => {
		// Hook returns null → base computed value (exp, no jitter) is used.
		vi.useFakeTimers();
		try {
			const ex = new BaseExecutor("test", {
				baseUrl: "https://x/api",
				retry: {
					429: {
						attempts: 3,
						delayMs: 100,
						backoff: "exp",
						maxDelayMs: 100,
						jitter: false,
					},
				},
				rng: () => 0,
			});
			const hookSpy = vi.fn().mockResolvedValue(null);
			ex.computeRetryDelay = hookSpy;

			fetchMock.mockResolvedValueOnce(res(429)).mockResolvedValueOnce(res(200));

			const promise = ex.execute({
				model: "m",
				body: {},
				stream: false,
				credentials: creds,
			});

			await vi.advanceTimersByTimeAsync(0);
			expect(fetchMock).toHaveBeenCalledTimes(1);

			// Before the base-computed 100ms delay, the retry must not have fired yet.
			await vi.advanceTimersByTimeAsync(99);
			expect(fetchMock).toHaveBeenCalledTimes(1);

			// At exactly 100ms the retry fetch fires (base value used because hook returned null).
			await vi.advanceTimersByTimeAsync(1);
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(hookSpy).toHaveBeenCalledTimes(1);

			const out = await promise;
			expect(out.response.status).toBe(200);
		} finally {
			vi.useRealTimers();
		}
	});
});
