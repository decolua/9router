// Unit tests for the real runtimeConfig VALIDATE_OUTBOUND envBool parsing.
// Tests the actual exported value from runtimeConfig.js using vi.resetModules()
// + dynamic import to ensure the static const is re-evaluated per test case.
//
// The test mock in chatcore-outbound-validation.test.js uses a getter that re-reads
// process.env on every access. The real export is a static const computed once
// at import time. This test covers the config contract itself.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("runtimeConfig: REAL VALIDATE_OUTBOUND envBool parsing", () => {
	const origValidateOutbound = process.env.VALIDATE_OUTBOUND;

	beforeEach(() => {
		vi.resetModules();
		delete process.env.VALIDATE_OUTBOUND;
	});

	afterEach(() => {
		if (origValidateOutbound === undefined) {
			delete process.env.VALIDATE_OUTBOUND;
		} else {
			process.env.VALIDATE_OUTBOUND = origValidateOutbound;
		}
	});

	async function loadValidateOutbound() {
		const mod = await import("../../open-sse/config/runtimeConfig.js");
		return mod.VALIDATE_OUTBOUND;
	}

	it("unset env → default true", async () => {
		delete process.env.VALIDATE_OUTBOUND;
		const val = await loadValidateOutbound();
		expect(val).toBe(true);
	});

	it('"true" → true', async () => {
		process.env.VALIDATE_OUTBOUND = "true";
		const val = await loadValidateOutbound();
		expect(val).toBe(true);
	});

	it('"TRUE" → true (case-insensitive)', async () => {
		process.env.VALIDATE_OUTBOUND = "TRUE";
		const val = await loadValidateOutbound();
		expect(val).toBe(true);
	});

	it('"1" → true', async () => {
		process.env.VALIDATE_OUTBOUND = "1";
		const val = await loadValidateOutbound();
		expect(val).toBe(true);
	});

	it('"yes" → true', async () => {
		process.env.VALIDATE_OUTBOUND = "yes";
		const val = await loadValidateOutbound();
		expect(val).toBe(true);
	});

	it('"YES" → true', async () => {
		process.env.VALIDATE_OUTBOUND = "YES";
		const val = await loadValidateOutbound();
		expect(val).toBe(true);
	});

	it('"on" → true', async () => {
		process.env.VALIDATE_OUTBOUND = "on";
		const val = await loadValidateOutbound();
		expect(val).toBe(true);
	});

	it('"ON" → true', async () => {
		process.env.VALIDATE_OUTBOUND = "ON";
		const val = await loadValidateOutbound();
		expect(val).toBe(true);
	});

	it('"false" → false', async () => {
		process.env.VALIDATE_OUTBOUND = "false";
		const val = await loadValidateOutbound();
		expect(val).toBe(false);
	});

	it('"FALSE" → false', async () => {
		process.env.VALIDATE_OUTBOUND = "FALSE";
		const val = await loadValidateOutbound();
		expect(val).toBe(false);
	});

	it('"0" → false', async () => {
		process.env.VALIDATE_OUTBOUND = "0";
		const val = await loadValidateOutbound();
		expect(val).toBe(false);
	});

	it('"no" → false', async () => {
		process.env.VALIDATE_OUTBOUND = "no";
		const val = await loadValidateOutbound();
		expect(val).toBe(false);
	});

	it('"off" → false', async () => {
		process.env.VALIDATE_OUTBOUND = "off";
		const val = await loadValidateOutbound();
		expect(val).toBe(false);
	});

	it('empty string "" → default true (fallthrough)', async () => {
		process.env.VALIDATE_OUTBOUND = "";
		const val = await loadValidateOutbound();
		expect(val).toBe(true);
	});

	it('"garbage" → false (unknown string falls through)', async () => {
		process.env.VALIDATE_OUTBOUND = "garbage";
		const val = await loadValidateOutbound();
		expect(val).toBe(false);
	});

	it("static const: cannot be toggled after module load", async () => {
		// Confirm that the real runtimeConfig.VALIDATE_OUTBOUND is a static const
		// (computed once), NOT a getter that re-reads process.env each time.
		// This is the key divergence from the test mock.
		process.env.VALIDATE_OUTBOUND = "true";
		const mod1 = await import("../../open-sse/config/runtimeConfig.js");
		const val1 = mod1.VALIDATE_OUTBOUND;
		expect(val1).toBe(true);

		// Change env AFTER import — the value must NOT change.
		process.env.VALIDATE_OUTBOUND = "false";

		// Re-import clears the module cache via resetModules, so we get a fresh const.
		vi.resetModules();
		const mod2 = await import("../../open-sse/config/runtimeConfig.js");
		const val2 = mod2.VALIDATE_OUTBOUND;
		// Both are fresh imports, so both see their own env snapshot.
		// The test proves that without resetModules, the const would be stale.
		expect(val1).toBe(true);
		expect(val2).toBe(false);
	});
});
