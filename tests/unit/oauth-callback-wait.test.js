import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "http";
import { startLocalServer, waitForCallbackParams } from "../../src/lib/oauth/utils/server.js";

describe("waitForCallbackParams", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with the params once the callback stores them", async () => {
    let params = null;
    const waiting = waitForCallbackParams(() => params, 300000);
    await vi.advanceTimersByTimeAsync(250);
    params = { code: "abc", state: "xyz" };
    await vi.advanceTimersByTimeAsync(100);
    await expect(waiting).resolves.toEqual({ code: "abc", state: "xyz" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timer behind when the wait times out", async () => {
    const waiting = waitForCallbackParams(() => null, 300000);
    const rejected = expect(waiting).rejects.toThrow(/Authentication timeout/);
    await vi.advanceTimersByTimeAsync(300000);
    await rejected;
    // The hand-rolled loops cleared their interval only on the success branch,
    // so a timed-out wait kept polling every 100ms for the life of the process.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops polling as soon as it settles", async () => {
    let calls = 0;
    const waiting = waitForCallbackParams(() => (++calls >= 3 ? { code: "ok" } : null), 300000);
    await vi.advanceTimersByTimeAsync(300);
    await waiting;
    const settledAt = calls;
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toBe(settledAt);
  });
});

// The callback server is bound to a port; a flow that gives up without closing
// it holds that port until the process exits. Codex uses a fixed port (1455),
// so the leak turns the next attempt into EADDRINUSE.
function isListening(port) {
  return new Promise((resolve) => {
    const probe = http.createServer(() => {});
    probe.once("error", (err) => resolve(err.code === "EADDRINUSE"));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(false)));
  });
}

describe("startLocalServer", () => {
  it("frees the port once closed, and tolerates a second close", async () => {
    const { port, close } = await startLocalServer(() => {});
    expect(await isListening(port)).toBe(true);
    close();
    expect(() => close()).not.toThrow();
    await new Promise((r) => setTimeout(r, 50));
    expect(await isListening(port)).toBe(false);
  });
});
