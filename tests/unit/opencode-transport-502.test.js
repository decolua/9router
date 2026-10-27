import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createSession: vi.fn(), loadRuntimeDep: vi.fn() }));

vi.mock("../../open-sse/services/lazyRuntime.js", () => ({
  loadRuntimeDep: mocks.loadRuntimeDep,
}));

const { opencodeTlsFetch, OpencodeTlsUnavailableError, resetOpencodeTlsSession } =
  await import("../../open-sse/services/opencodeTlsClient.js");

beforeEach(() => {
  vi.clearAllMocks();
  resetOpencodeTlsSession();
  mocks.loadRuntimeDep.mockResolvedValue({ createSession: mocks.createSession });
});
afterEach(() => { resetOpencodeTlsSession(); });

describe("OpenCode TLS transport failures surface as unavailable, not 502", () => {
  it("wraps a session.fetch throw so the caller's fallback can run", async () => {
    mocks.createSession.mockReturnValue({
      fetch: vi.fn().mockRejectedValue(new Error("tunnel refused")),
      close: vi.fn(),
    });

    const err = await opencodeTlsFetch("https://opencode.ai/a", {}).catch((e) => e);
    // Not a bare Error: the executor only falls back for this type. Anything else
    // propagates to BaseExecutor and reaches the client as 502 Bad Gateway.
    expect(err).toBeInstanceOf(OpencodeTlsUnavailableError);
    expect(err.message).toContain("tunnel refused");
  });

  it("drops the failed session so the next call rebuilds it", async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("tunnel refused"))
      .mockResolvedValueOnce({ status: 200, statusText: "OK", headers: { forEach: () => { } }, body: null });
    const close = vi.fn();
    mocks.createSession.mockReturnValue({ fetch, close });

    await expect(opencodeTlsFetch("https://opencode.ai/a", {})).rejects.toBeInstanceOf(OpencodeTlsUnavailableError);
    const res = await opencodeTlsFetch("https://opencode.ai/a", {});

    expect(res.status).toBe(200);
    expect(mocks.createSession).toHaveBeenCalledTimes(2);
  });

  it("still reports an HTTP error status as a response, not an exception", async () => {
    mocks.createSession.mockReturnValue({
      fetch: vi.fn().mockResolvedValue({ status: 429, statusText: "Too Many Requests", headers: { forEach: () => { } }, body: null }),
      close: vi.fn(),
    });

    const res = await opencodeTlsFetch("https://opencode.ai/a", {});
    expect(res.status).toBe(429);
  });
});
