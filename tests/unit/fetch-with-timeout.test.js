import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
} from "../../src/lib/network/fetchWithTimeout.js";

let realFetch;

beforeEach(() => {
  realFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

// Resolves only when the caller aborts — stands in for an upstream that accepts
// the connection and never answers.
function hangingFetch() {
  const calls = [];
  globalThis.fetch = vi.fn((url, init) => {
    calls.push({ url, init });
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal.reason ?? new Error("aborted")));
    });
  });
  return calls;
}

describe("fetchWithTimeout", () => {
  it("aborts the request when the deadline passes, not just the wait", async () => {
    vi.useFakeTimers();
    const calls = hangingFetch();

    const pending = fetchWithTimeout("https://example.invalid/probe", { method: "GET" }, 500);
    const rejects = expect(pending).rejects.toThrow(/timed out after 500ms/);

    expect(calls[0].init.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    await rejects;

    // The point of the abort: the request itself ends, so the socket is not
    // left open until the upstream feels like answering.
    expect(calls[0].init.signal.aborted).toBe(true);
  });

  it("clears its timer once the response arrives", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async () => new Response("ok"));

    const res = await fetchWithTimeout("https://example.invalid/probe");
    expect(res.status).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its timer when fetch rejects", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async () => { throw new Error("ECONNREFUSED"); });

    await expect(fetchWithTimeout("https://example.invalid/probe")).rejects.toThrow("ECONNREFUSED");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves a caller-supplied signal in charge", async () => {
    const calls = hangingFetch();
    const own = AbortSignal.timeout(20);

    await expect(fetchWithTimeout("https://example.invalid/probe", { signal: own })).rejects.toThrow();
    expect(calls[0].init.signal).toBe(own);
  });

  it("forwards method, headers and body unchanged", async () => {
    globalThis.fetch = vi.fn(async () => new Response("ok"));
    await fetchWithTimeout("https://example.invalid/probe", {
      method: "POST",
      headers: { "x-test": "1" },
      body: "{}",
    });

    const init = globalThis.fetch.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "x-test": "1" });
    expect(init.body).toBe("{}");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("defaults to a ten second deadline", () => {
    expect(DEFAULT_FETCH_TIMEOUT_MS).toBe(10000);
  });
});

// The dashboard's "test connection" buttons run these routes. A probe with no
// deadline leaves the button spinning and the socket open for as long as the
// upstream cares to hold it.
describe("provider validation routes have no un-deadlined probe", () => {
  const ROUTES = [
    "src/app/api/providers/validate/route.js",
    "src/app/api/provider-nodes/validate/route.js",
  ];

  it.each(ROUTES)("%s calls fetch only through fetchWithTimeout", async (rel) => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const source = fs.readFileSync(path.join(repoRoot, rel), "utf8");

    const bare = [...source.matchAll(/(?<!fetchWith[A-Za-z]*)\bfetch\(/g)];
    expect(bare.map((m) => source.slice(Math.max(0, m.index - 40), m.index + 10))).toEqual([]);
    expect(source).toContain("fetchWithTimeout");
  });
});
