/**
 * Regression tests for QA-9ROUTER-18 — the global fetch patch must be
 * idempotent across module re-evaluations.
 *
 * Defect (measured 2026-09-18, pre-fix): open-sse/utils/proxyFetch.js captured
 * `const originalFetch = globalThis.fetch` at MODULE EVALUATION and installed
 * `globalThis.fetch = patchedFetch` at the bottom behind a guard that only
 * skipped installation when the installed function was *identical* to the
 * current module's `patchedFetch`. Every re-evaluation (vitest resetModules,
 * dev/HMR, next worker threads) creates a NEW function object, so the guard
 * never tripped and the new wrapper captured the PREVIOUS wrapper as its
 * "original" fetch. Each stacked layer re-attempted the dead proxy:
 *
 *   evaluations 1 / 2 / 4  ->  1 / 3 / 15 proxy attempts + warnings per fetch
 *   (2^N-1), 262,143 log lines in the QA chaos cell.
 *
 * The fix tags the wrapper with Symbol.for("9router.proxyFetch.patched") and
 * resolves the real inner fetch at CALL time, so a stack collapses to the real
 * fetch and the patch is installed at most once per global. Because the whole
 * point is that the module LOG FLOOD is gone, the regression pin is on the
 * growth shape (proxy attempts / warnings per cycle), not on a happy path.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";

const DEAD_PROXY = "http://127.0.0.1:9";

const PATCH_MARK = Symbol.for("9router.proxyFetch.patched");
const INNER_FETCH = Symbol.for("9router.proxyFetch.innerFetch");
const PROXY_WARN_SEEN = Symbol.for("9router.proxyFetch.warnedProxyFailures");

const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
];

// Evaluation counts the regression must survive. 8 is past the point where the
// pre-fix wrapper stack produced 255 warnings for a SINGLE fetch.
const EVAL_COUNTS = [1, 2, 4, 8];

let savedEnv;
let originalFetch;

function makeInnerStub() {
  // Stands in for the real (native) fetch: the proxy attempt fails like a dead
  // proxy does, the direct fallback succeeds. Counts live on the mock.
  return vi.fn(async (_url, options = {}) => {
    if (options.dispatcher) throw new Error("fetch failed");
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

const innerCallCount = (stub) => stub.mock.calls.length;
const directCallCount = (stub) =>
  stub.mock.calls.filter(([, options]) => !(options && options.dispatcher)).length;

function proxyFallbackWarnCount(warnSpy) {
  return warnSpy.mock.calls.filter((args) => String(args[0]).includes("[ProxyFetch] Proxy failed")).length;
}

describe("proxyFetch — idempotent global patch across module re-evaluations", () => {
  let warnSpy;

  beforeEach(() => {
    savedEnv = {};
    for (const key of PROXY_ENV_KEYS) savedEnv[key] = process.env[key];

    // Dead proxy: every proxy attempt fails, every direct fetch succeeds.
    process.env.HTTP_PROXY = DEAD_PROXY;
    process.env.HTTPS_PROXY = DEAD_PROXY;
    process.env.ALL_PROXY = DEAD_PROXY;
    delete process.env.NO_PROXY;
    delete process.env.no_proxy;

    originalFetch = globalThis.fetch;
    // Start from an empty process-wide dedupe registry so the warning-count
    // assertions below do not depend on what another test already logged.
    delete globalThis[PROXY_WARN_SEEN];
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.restoreAllMocks();

    globalThis.fetch = originalFetch;
    delete globalThis[PROXY_WARN_SEEN];

    for (const key of PROXY_ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  afterAll(() => {
    // Leave no process-wide patch state behind for the rest of the suite.
    delete globalThis[PROXY_WARN_SEEN];
    if (typeof globalThis.fetch === "function") {
      delete globalThis.fetch[PATCH_MARK];
      delete globalThis.fetch[INNER_FETCH];
    }
    vi.resetModules();
  });

  it("does not stack wrappers or blow up the log across 1/2/4/8 re-evaluations", async () => {
    const stub = makeInnerStub();
    globalThis.fetch = stub;

    let cycles = 0;
    let installedFetch = null;
    let reinstalls = 0; // evaluations that replaced the installed wrapper
    let missingMark = 0; // evaluations that left an UNTAGGED wrapper installed

    for (const n of EVAL_COUNTS) {
      for (let i = 0; i < n; i++) {
        vi.resetModules();
        await import("../../open-sse/utils/proxyFetch.js");
        cycles += 1;

        if (installedFetch === null) installedFetch = globalThis.fetch;
        else if (globalThis.fetch !== installedFetch) reinstalls += 1;
        if (globalThis.fetch[PATCH_MARK] !== true) missingMark += 1;

        await globalThis.fetch("https://api.example.com/v1/models");
      }

      // (a) at most one direct fallback (+ its failed proxy attempt) per fetch,
      // whatever the evaluation depth. Pre-fix these grow as 2^N-1.
      expect(innerCallCount(stub)).toBeLessThanOrEqual(2 * cycles);
      expect(directCallCount(stub)).toBeLessThanOrEqual(cycles);
    }

    // Exactly linear: 2 * evaluations for the whole run (pre-fix: sum of 2^N).
    expect(innerCallCount(stub)).toBe(2 * cycles);
    expect(directCallCount(stub)).toBe(cycles);

    // The patch is installed ONCE and is always tagged with its inner fetch.
    expect(reinstalls).toBe(0);
    expect(missingMark).toBe(0);

    // (b) dedupe: the proxy-failure warning is emitted ONCE per process and
    // never grows with the number of evaluations (pre-fix: 2^N-1 per fetch).
    const warns = proxyFallbackWarnCount(warnSpy);
    expect(warns).toBeGreaterThanOrEqual(1);
    expect(warns).toBeLessThanOrEqual(2);

    // (c) no stacking: the installed global fetch performs exactly one inner
    // call per invocation after all those re-evaluations.
    const innerBefore = innerCallCount(stub);
    const directBefore = directCallCount(stub);
    const res = await globalThis.fetch("https://api.example.com/v1/models");

    expect(res.status).toBe(200);
    expect(directCallCount(stub) - directBefore).toBe(1);
    expect(innerCallCount(stub) - innerBefore).toBe(2);
  });

  it("resolves the inner fetch at call time, so a later stub is respected", async () => {
    // A test (or an app) that replaces globalThis.fetch AFTER proxyFetch was
    // evaluated must still be the fetch that performs the request: the module
    // must not keep using its evaluation-time capture.
    vi.resetModules();
    const mod = await import("../../open-sse/utils/proxyFetch.js");

    const evalTimeStub = makeInnerStub();
    const freshStub = makeInnerStub();
    globalThis.fetch = evalTimeStub;

    vi.resetModules();
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    expect(typeof proxyAwareFetch).toBe("function");
    expect(typeof mod.proxyAwareFetch).toBe("function");

    globalThis.fetch = freshStub;
    const res = await proxyAwareFetch("https://api.example.com/v1/models");

    expect(res.status).toBe(200);
    // The stub installed AFTER evaluation is the one that ran (with the dead
    // proxy it is tried once via the proxy and once as the direct fallback).
    expect(innerCallCount(freshStub)).toBeGreaterThanOrEqual(1);
    expect(directCallCount(freshStub)).toBe(1);
    expect(innerCallCount(evalTimeStub)).toBe(0);
  });

  it("keeps the strictProxy throw behaviour (no silent fallback, no new warnings)", async () => {
    vi.resetModules();
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

    const stub = makeInnerStub();
    globalThis.fetch = stub;
    const warnsBefore = proxyFallbackWarnCount(warnSpy);

    await expect(
      proxyAwareFetch(
        "https://api.example.com/v1/models",
        {},
        { enabled: true, url: DEAD_PROXY, strictProxy: true },
      ),
    ).rejects.toThrow(/strictProxy=true/);

    // strictProxy must throw BEFORE the fallback, so nothing new is logged.
    expect(proxyFallbackWarnCount(warnSpy)).toBe(warnsBefore);
    expect(directCallCount(stub)).toBe(0);
  });
});
