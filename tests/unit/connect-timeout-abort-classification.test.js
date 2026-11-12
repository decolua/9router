/**
 * Item 3 — abort classification must not depend on error.name.
 *
 * `connectCtrl.abort(new Error("fetch connect timeout"))` makes undici reject
 * with that Error (name "Error"), so the old `error.name === "AbortError"`
 * checks never matched a real connect timeout. Symmetrically, a CALLER abort
 * with a custom reason is also an "Error", so the rethrow guard missed it and
 * the executor retried/walked fallbacks for a client that had already left.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockRootUndiciFetch, unmockRootUndiciFetch } from "../helpers/undiciFetchMock.js";

const savedEnv = { ...process.env };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Reject with the signal's own abort reason — undici's real shape. */
function abortReasonFetch() {
  return vi.fn((_url, opts) => new Promise((_resolve, reject) => {
    const signal = opts?.signal;
    const onAbort = () => reject(signal.reason ?? new DOMException("aborted", "AbortError"));
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  }));
}

function log() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("BaseExecutor — caller abort is not a retryable network error", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...savedEnv };
    for (const key of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    unmockRootUndiciFetch();
  });

  it("a caller abort with a custom reason throws immediately — no retry, no fallback URL", async () => {
    const fetchMock = abortReasonFetch();
    mockRootUndiciFetch(fetchMock);
    const { BaseExecutor } = await import("../../open-sse/executors/base.js");

    const executor = new BaseExecutor("abort-test", {
      baseUrls: ["https://a.test/v1/chat", "https://b.test/v1/chat"],
      retry: { 502: { attempts: 3, delayMs: 0 } },
    });
    const controller = new AbortController();
    const pending = executor.execute({
      model: "m",
      body: { messages: [] },
      stream: false,
      credentials: { apiKey: "k" },
      signal: controller.signal,
      log: log(),
    });

    await sleep(20);
    controller.abort(new Error("client left"));
    await expect(pending).rejects.toThrow("client left");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a real connect timeout (abort reason is an Error) is retried as a network error", async () => {
    const fetchMock = abortReasonFetch();
    mockRootUndiciFetch(fetchMock);
    const { BaseExecutor } = await import("../../open-sse/executors/base.js");

    const executor = new BaseExecutor("timeout-test", {
      baseUrls: ["https://a.test/v1/chat"],
      timeoutMs: 10,
      retry: { 502: { attempts: 1, delayMs: 0 } },
    });

    await expect(executor.execute({
      model: "m",
      body: { messages: [] },
      stream: false,
      credentials: { apiKey: "k" },
      signal: new AbortController().signal,
      log: log(),
    })).rejects.toThrow("fetch connect timeout");
    // The timeout is internal: it goes through the 502 retry path, not out as
    // an AbortError to the caller.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
