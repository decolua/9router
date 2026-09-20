import { describe, it, expect, vi, afterEach } from "vitest";
import { refreshWithRetry } from "../../open-sse/services/tokenRefresh.js";

afterEach(() => vi.useRealTimers());
describe("token refresh cancellation", () => {
  it("does not refresh after a caller has cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const refresh = vi.fn();
    expect(await refreshWithRetry(refresh, 3, null, controller.signal)).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
  it("cancels retry backoff without another refresh or lingering timer", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const refresh = vi.fn(async () => null);
    const pending = refreshWithRetry(refresh, 3, null, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    controller.abort();
    expect(await pending).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
