import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	probeHeadroom,
	probeHeadroomCached,
	_resetProbeCache,
	CANDIDATE_URLS,
} from "../../src/lib/headroom/probe.js";

let _origFetch;

// Fake fetch Response helpers — probeUrl treats a response as headroom-like when
// data has messages[] OR tokens_saved/tokens_before numbers (see probe.js).
const okHeadroom = (extra = {}) => ({
	ok: true,
	status: 200,
	json: async () => ({ messages: [{ role: "user", content: "x" }], tokens_saved: 5, tokens_before: 10, ...extra }),
});
const fail = (status = 503) => ({ ok: false, status, json: async () => ({}) });

// Build a fetch mock that returns okHeadroom for URLs whose /v1/compress endpoint
// starts with one of `reachable`, else fails.
const fetchReachable = (reachable) =>
	async (endpoint) => {
		const ep = String(endpoint);
		for (const base of reachable) {
			if (ep.startsWith(base)) return okHeadroom();
		}
		return fail();
	};

describe("probeHeadroom — source/availability contract (real probe, not defaults)", () => {
	beforeEach(() => { _resetProbeCache(); _origFetch = global.fetch; });
	afterEach(() => { global.fetch = _origFetch; });

	it("fresh install, no reachable backend → source=unavailable, ok=false, url=null", async () => {
		global.fetch = vi.fn(async () => fail());
		const r = await probeHeadroom(); // no customUrl
		expect(r.source).toBe("unavailable");
		expect(r.ok).toBe(false);
		expect(r.url).toBeNull();
	});

	it("custom URL reachable → source=custom, ok=true", async () => {
		const custom = "http://192.168.1.50:8787";
		global.fetch = fetchReachable([custom]);
		const r = await probeHeadroom({ customUrl: custom });
		expect(r.source).toBe("custom");
		expect(r.ok).toBe(true);
		expect(r.url).toBe(custom);
	});

	it("auto-detected candidate reachable (no custom) → source=detected, ok=true", async () => {
		const detected = CANDIDATE_URLS[0]; // http://localhost:8787
		global.fetch = fetchReachable([detected]);
		const r = await probeHeadroom(); // no customUrl → probes candidates
		expect(r.source).toBe("detected");
		expect(r.ok).toBe(true);
		expect(r.url).toBe(detected);
	});

	it("a customUrl equal to a default candidate is NOT labelled 'custom' (falls to detected)", async () => {
		const detected = CANDIDATE_URLS[0];
		global.fetch = fetchReachable([detected]);
		const r = await probeHeadroom({ customUrl: detected });
		expect(r.source).toBe("detected");
	});

	it("never reports 'native' (no native compressor exists)", async () => {
		global.fetch = vi.fn(async () => fail());
		const r = await probeHeadroom();
		expect(r.source).not.toBe("native");
	});
});

describe("probeHeadroomCached — same contract, cached", () => {
	beforeEach(() => { _resetProbeCache(); _origFetch = global.fetch; });
	afterEach(() => { global.fetch = _origFetch; });

	it("unavailable when nothing reachable", async () => {
		global.fetch = vi.fn(async () => fail());
		const r = await probeHeadroomCached();
		expect(r.source).toBe("unavailable");
		expect(r.ok).toBe(false);
	});

	it("custom reachable", async () => {
		const custom = "http://10.0.0.5:8787";
		global.fetch = fetchReachable([custom]);
		const r = await probeHeadroomCached({ customUrl: custom });
		expect(r.source).toBe("custom");
		expect(r.ok).toBe(true);
	});

	it("detected reachable", async () => {
		const detected = CANDIDATE_URLS[1]; // 127.0.0.1:8787
		global.fetch = fetchReachable([detected]);
		const r = await probeHeadroomCached();
		expect(r.source).toBe("detected");
		expect(r.ok).toBe(true);
	});
});
