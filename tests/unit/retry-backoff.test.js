// Pure-function tests for computeBackoffDelay + resolveRetryEntry normalization.
// computeBackoffDelay must be deterministic when an RNG is injected, and the
// cap semantics must hold for every backoff/jitter combination the executor
// can produce.
import { describe, it, expect } from "vitest";
import {
	computeBackoffDelay,
	resolveRetryEntry,
} from "../../open-sse/config/runtimeConfig.js";

describe("computeBackoffDelay — full jitter, deterministic via injected rng", () => {
	it("rng=0 returns 0 (exp + jitter)", () => {
		expect(
			computeBackoffDelay({
				attempt: 1,
				baseDelayMs: 1000,
				maxDelayMs: 8000,
				backoff: "exp",
				jitter: true,
				rng: () => 0,
			}),
		).toBe(0);
	});

	it("rng=0 returns 0 (fixed + jitter)", () => {
		expect(
			computeBackoffDelay({
				attempt: 5,
				baseDelayMs: 2000,
				maxDelayMs: 2000,
				backoff: "fixed",
				jitter: true,
				rng: () => 0,
			}),
		).toBe(0);
	});

	it("rng=1 returns floor(cap) for exp attempt 3 (base 1000, max 8000 → cap 4000)", () => {
		// exp attempt 3: 1000 * 2^(3-1) = 4000, under maxDelayMs=8000
		expect(
			computeBackoffDelay({
				attempt: 3,
				baseDelayMs: 1000,
				maxDelayMs: 8000,
				backoff: "exp",
				jitter: true,
				rng: () => 1,
			}),
		).toBe(4000);
	});

	it("rng=0.999 returns floor(0.999 * cap) for exp attempt 3 (cap 4000)", () => {
		expect(
			computeBackoffDelay({
				attempt: 3,
				baseDelayMs: 1000,
				maxDelayMs: 8000,
				backoff: "exp",
				jitter: true,
				rng: () => 0.999,
			}),
		).toBe(Math.floor(0.999 * 4000));
	});

	it("rng=0.5 returns floor(0.5 * cap) for exp attempt 4 (cap clamped at 8000)", () => {
		// exp attempt 4: 1000 * 2^3 = 8000, equal to maxDelayMs=8000
		expect(
			computeBackoffDelay({
				attempt: 4,
				baseDelayMs: 1000,
				maxDelayMs: 8000,
				backoff: "exp",
				jitter: true,
				rng: () => 0.5,
			}),
		).toBe(Math.floor(0.5 * 8000));
	});

	it("rng=0.5 returns floor(0.5 * cap) for exp attempt 1 (cap = base)", () => {
		// exp attempt 1: 1000 * 2^0 = 1000
		expect(
			computeBackoffDelay({
				attempt: 1,
				baseDelayMs: 1000,
				maxDelayMs: 8000,
				backoff: "exp",
				jitter: true,
				rng: () => 0.5,
			}),
		).toBe(500);
	});
});

describe("computeBackoffDelay — exp cap clamps to maxDelayMs", () => {
	it("attempt 10 with base 1000 clamps to maxDelayMs=8000", () => {
		expect(
			computeBackoffDelay({
				attempt: 10,
				baseDelayMs: 1000,
				maxDelayMs: 8000,
				backoff: "exp",
				jitter: false,
			}),
		).toBe(8000);
	});

	it("attempt 50 with base 100 clamps to maxDelayMs=2000 (overflow guard)", () => {
		// 100 * 2^49 overflows; cap falls back to maxDelayMs.
		expect(
			computeBackoffDelay({
				attempt: 50,
				baseDelayMs: 100,
				maxDelayMs: 2000,
				backoff: "exp",
				jitter: false,
			}),
		).toBe(2000);
	});

	it("without jitter, attempt 2 returns 2x base (unscaled cap)", () => {
		expect(
			computeBackoffDelay({
				attempt: 2,
				baseDelayMs: 1000,
				maxDelayMs: 8000,
				backoff: "exp",
				jitter: false,
			}),
		).toBe(2000);
	});

	it("without jitter, fixed backoff always returns baseDelayMs", () => {
		expect(
			computeBackoffDelay({
				attempt: 5,
				baseDelayMs: 2000,
				maxDelayMs: 9999, // ignored for fixed
				backoff: "fixed",
				jitter: false,
			}),
		).toBe(2000);
	});
});

describe("computeBackoffDelay — defensive coercion", () => {
	it("clamps attempt to >= 1 (attempt=0 → exp(0) → base)", () => {
		expect(
			computeBackoffDelay({
				attempt: 0,
				baseDelayMs: 1000,
				maxDelayMs: 8000,
				backoff: "exp",
				jitter: false,
			}),
		).toBe(1000);
	});

	it("baseDelayMs=0 yields cap 0 for any attempt/jitter combo", () => {
		expect(
			computeBackoffDelay({
				attempt: 5,
				baseDelayMs: 0,
				maxDelayMs: 9999,
				backoff: "exp",
				jitter: false,
			}),
		).toBe(0);
		expect(
			computeBackoffDelay({
				attempt: 5,
				baseDelayMs: 0,
				maxDelayMs: 9999,
				backoff: "exp",
				jitter: true,
				rng: () => 0.7,
			}),
		).toBe(0);
	});

	it("maxDelayMs < baseDelayMs is floored at baseDelayMs", () => {
		// exp attempt 1: base 1000 * 2^0 = 1000, but max 100 → floored to 1000
		expect(
			computeBackoffDelay({
				attempt: 1,
				baseDelayMs: 1000,
				maxDelayMs: 100,
				backoff: "exp",
				jitter: false,
			}),
		).toBe(1000);
	});

	it("rng returning NaN or negative produces 0", () => {
		expect(
			computeBackoffDelay({
				attempt: 3,
				baseDelayMs: 1000,
				maxDelayMs: 8000,
				backoff: "exp",
				jitter: true,
				rng: () => NaN,
			}),
		).toBe(0);
		expect(
			computeBackoffDelay({
				attempt: 3,
				baseDelayMs: 1000,
				maxDelayMs: 8000,
				backoff: "exp",
				jitter: true,
				rng: () => -0.5,
			}),
		).toBe(0);
	});
});

describe("computeBackoffDelay — bounded range sweeps", () => {
	it("non-jittered exp sweep is monotonically non-decreasing and capped", () => {
		const base = 100;
		const max = 5000;
		let prev = -Infinity;
		for (let n = 1; n <= 12; n++) {
			const v = computeBackoffDelay({
				attempt: n,
				baseDelayMs: base,
				maxDelayMs: max,
				backoff: "exp",
				jitter: false,
			});
			expect(v).toBeLessThanOrEqual(max);
			expect(v).toBeGreaterThanOrEqual(prev); // monotonically non-decreasing
			expect(v).toBeGreaterThanOrEqual(0);
			prev = v;
		}
	});

	it("jittered exp sweep stays inside [0, cap] for every attempt", () => {
		const base = 100;
		const max = 2000;
		for (let n = 1; n <= 12; n++) {
			const expectedCap = Math.min(base * 2 ** (n - 1), max);
			// Sweep a few RNG samples; each must fall inside [0, expectedCap].
			for (const sample of [0, 0.001, 0.25, 0.5, 0.75, 0.999, 1]) {
				const v = computeBackoffDelay({
					attempt: n,
					baseDelayMs: base,
					maxDelayMs: max,
					backoff: "exp",
					jitter: true,
					rng: () => sample,
				});
				expect(v).toBeGreaterThanOrEqual(0);
				expect(v).toBeLessThanOrEqual(expectedCap);
			}
		}
	});

	it("default Math.random (no rng override) produces values in [0, cap]", () => {
		const cap = 5000;
		for (let i = 0; i < 25; i++) {
			const v = computeBackoffDelay({
				attempt: 1,
				baseDelayMs: cap,
				maxDelayMs: cap,
				backoff: "fixed",
				jitter: true,
			});
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThanOrEqual(cap);
		}
	});
});

describe("resolveRetryEntry — shape normalization", () => {
	it("null → zero attempts, fixed delay, no jitter", () => {
		expect(resolveRetryEntry(null)).toEqual({
			attempts: 0,
			delayMs: 2000,
			backoff: "fixed",
			maxDelayMs: 2000,
			jitter: false,
		});
	});

	it("undefined → zero attempts, fixed delay, no jitter", () => {
		expect(resolveRetryEntry(undefined)).toEqual({
			attempts: 0,
			delayMs: 2000,
			backoff: "fixed",
			maxDelayMs: 2000,
			jitter: false,
		});
	});

	it("number is treated as attempts (legacy back-compat)", () => {
		expect(resolveRetryEntry(3)).toEqual({
			attempts: 3,
			delayMs: 2000,
			backoff: "fixed",
			maxDelayMs: 2000,
			jitter: false,
		});
	});

	it("object with all fields preserved", () => {
		expect(
			resolveRetryEntry({
				attempts: 5,
				delayMs: 100,
				backoff: "exp",
				maxDelayMs: 8000,
				jitter: true,
			}),
		).toEqual({
			attempts: 5,
			delayMs: 100,
			backoff: "exp",
			maxDelayMs: 8000,
			jitter: true,
		});
	});

	it("object missing delayMs falls back to RETRY_CONFIG.delayMs and max=delayMs", () => {
		const r = resolveRetryEntry({ attempts: 2 });
		expect(r.attempts).toBe(2);
		expect(r.delayMs).toBe(2000);
		expect(r.maxDelayMs).toBe(2000);
		expect(r.backoff).toBe("fixed");
		expect(r.jitter).toBe(false);
	});

	it("object missing maxDelayMs defaults to delayMs (not RETRY_CONFIG.delayMs)", () => {
		const r = resolveRetryEntry({
			attempts: 1,
			delayMs: 500,
			backoff: "exp",
			jitter: true,
		});
		expect(r.maxDelayMs).toBe(500);
		expect(r.delayMs).toBe(500);
	});

	it("backoff='exp' is preserved; backoff='fixed' and other strings normalize to 'fixed'", () => {
		expect(resolveRetryEntry({ attempts: 1, backoff: "exp" }).backoff).toBe(
			"exp",
		);
		expect(resolveRetryEntry({ attempts: 1, backoff: "fixed" }).backoff).toBe(
			"fixed",
		);
		expect(resolveRetryEntry({ attempts: 1, backoff: "linear" }).backoff).toBe(
			"fixed",
		);
		expect(resolveRetryEntry({ attempts: 1 }).backoff).toBe("fixed");
	});

	it("jitter requires strict true (truthy values other than true stay false)", () => {
		expect(resolveRetryEntry({ attempts: 1, jitter: true }).jitter).toBe(true);
		expect(resolveRetryEntry({ attempts: 1, jitter: false }).jitter).toBe(
			false,
		);
		expect(resolveRetryEntry({ attempts: 1, jitter: 1 }).jitter).toBe(false);
		expect(resolveRetryEntry({ attempts: 1 }).jitter).toBe(false);
	});

	it("attempts=0 / falsy resolves to 0 (no retries)", () => {
		expect(resolveRetryEntry({ attempts: 0 }).attempts).toBe(0);
		expect(resolveRetryEntry({}).attempts).toBe(0);
	});

	it("resolved shape composes cleanly with computeBackoffDelay", () => {
		// End-to-end: an entry-shaped object resolves and feeds computeBackoffDelay.
		const entry = resolveRetryEntry({
			attempts: 3,
			delayMs: 1000,
			backoff: "exp",
			maxDelayMs: 8000,
			jitter: true,
		});
		// attempt 2, rng 0 → 0
		expect(
			computeBackoffDelay({
				attempt: 2,
				baseDelayMs: entry.delayMs,
				maxDelayMs: entry.maxDelayMs,
				backoff: entry.backoff,
				jitter: entry.jitter,
				rng: () => 0,
			}),
		).toBe(0);
		// attempt 2, rng 1 → base * 2^1 = 2000 (under maxDelayMs)
		expect(
			computeBackoffDelay({
				attempt: 2,
				baseDelayMs: entry.delayMs,
				maxDelayMs: entry.maxDelayMs,
				backoff: entry.backoff,
				jitter: entry.jitter,
				rng: () => 1,
			}),
		).toBe(2000);
	});

	it("partial entry missing backoff/jitter defaults to fixed/no-jitter", () => {
		// Only attempts and delayMs specified — backoff and jitter should default
		const r = resolveRetryEntry({ attempts: 3, delayMs: 500 });
		expect(r.backoff).toBe("fixed");
		expect(r.jitter).toBe(false);
		expect(r.maxDelayMs).toBe(500); // defaults to delayMs
	});

	it("partial entry missing maxDelayMs uses delayMs as max", () => {
		const r = resolveRetryEntry({ attempts: 2, delayMs: 1500, backoff: "exp" });
		expect(r.maxDelayMs).toBe(1500);
		expect(r.delayMs).toBe(1500);
	});
});

describe("computeBackoffDelay — edge-case coercion", () => {
	it("maxDelayMs=0 floors to baseDelayMs (exp)", () => {
		// When maxDelayMs is 0, safeMax = Math.max(safeBase, 0) = safeBase
		expect(
			computeBackoffDelay({
				attempt: 5,
				baseDelayMs: 1000,
				maxDelayMs: 0,
				backoff: "exp",
				jitter: false,
			}),
		).toBe(1000);
	});

	it("maxDelayMs=0 with jitter still respects cap=base", () => {
		expect(
			computeBackoffDelay({
				attempt: 3,
				baseDelayMs: 1000,
				maxDelayMs: 0,
				backoff: "exp",
				jitter: true,
				rng: () => 0.5,
			}),
		).toBe(500);
	});

	it("baseDelayMs=NaN coerces to 0 (safe base)", () => {
		expect(
			computeBackoffDelay({
				attempt: 3,
				baseDelayMs: NaN,
				maxDelayMs: 5000,
				backoff: "exp",
				jitter: false,
			}),
		).toBe(0);
	});

	it("maxDelayMs=NaN coerces to safeBase", () => {
		expect(
			computeBackoffDelay({
				attempt: 3,
				baseDelayMs: 1000,
				maxDelayMs: NaN,
				backoff: "exp",
				jitter: false,
			}),
		).toBe(1000);
	});

	it("negative baseDelayMs coerces to 0", () => {
		expect(
			computeBackoffDelay({
				attempt: 2,
				baseDelayMs: -500,
				maxDelayMs: 5000,
				backoff: "exp",
				jitter: false,
			}),
		).toBe(0);
	});

	it("negative maxDelayMs floors to safeBase", () => {
		expect(
			computeBackoffDelay({
				attempt: 2,
				baseDelayMs: 1000,
				maxDelayMs: -100,
				backoff: "exp",
				jitter: false,
			}),
		).toBe(1000);
	});

	it("float attempt (3.7) truncates via bitwise OR to 3", () => {
		// 3.7 | 0 === 3 (bitwise OR truncates to 32-bit integer)
		// safeAttempt = Math.max(1, 3) = 3
		// exp cap = 1000 * 2^(3-1) = 1000 * 4 = 4000
		expect(
			computeBackoffDelay({
				attempt: 3.7,
				baseDelayMs: 1000,
				maxDelayMs: 8000,
				backoff: "exp",
				jitter: false,
			}),
		).toBe(4000); // 1000 * 2^2 = 4000 (attempt 3)
	});

	it("very large negative attempt clamps to 1", () => {
		expect(
			computeBackoffDelay({
				attempt: -999999,
				baseDelayMs: 1000,
				maxDelayMs: 8000,
				backoff: "exp",
				jitter: false,
			}),
		).toBe(1000); // attempt clamped to 1: 1000 * 2^0 = 1000
	});
});
