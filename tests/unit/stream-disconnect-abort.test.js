import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStreamController, pipeWithDisconnect } from "../../open-sse/utils/streamHandler.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("stream disconnect cancellation (#4914)", () => {
  it("aborts upstream before notifying disconnect observers", () => {
    const observed = [];
    const ctrl = createStreamController({
      onDisconnect: ({ reason, duration }) => observed.push({
        reason, duration, aborted: ctrl.signal.aborted, connected: ctrl.isConnected(),
      }),
    });
    vi.advanceTimersByTime(25);

    ctrl.handleDisconnect("client_closed");

    expect(ctrl.signal.aborted).toBe(true);
    expect(ctrl.signal.reason.name).toBe("AbortError");
    expect(observed).toEqual([{ reason: "client_closed", duration: 25, aborted: true, connected: false }]);
  });

  it("does not leave cancellation waiting on a timer", () => {
    const ctrl = createStreamController();
    ctrl.handleDisconnect();
    expect(vi.getTimerCount()).toBe(0);
    expect(ctrl.signal.aborted).toBe(true);
  });

  it("notifies upstream and disconnect observers only once", () => {
    const onDisconnect = vi.fn();
    const onAbort = vi.fn();
    const ctrl = createStreamController({ onDisconnect });
    ctrl.signal.addEventListener("abort", onAbort);
    ctrl.handleDisconnect("first");
    ctrl.handleDisconnect("second");
    ctrl.handleComplete();
    ctrl.handleError(new Error("late transport error"));

    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onDisconnect).toHaveBeenCalledExactlyOnceWith({ reason: "first", duration: 0 });
  });

  it("keeps cancellation isolated to the disconnected request", () => {
    const first = createStreamController();
    const second = createStreamController();
    first.handleDisconnect();
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(second.isConnected()).toBe(true);
  });

  it("does not abort a normally completed request on a late disconnect", () => {
    const onDisconnect = vi.fn();
    const ctrl = createStreamController({ onDisconnect });
    ctrl.handleComplete();
    ctrl.handleDisconnect();
    expect(ctrl.signal.aborted).toBe(false);
    expect(ctrl.isConnected()).toBe(false);
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it("preserves error notification without a later disconnect notification", () => {
    const error = new Error("upstream failed");
    const onError = vi.fn();
    const onDisconnect = vi.fn();
    const ctrl = createStreamController({ onError, onDisconnect, log: { errorLine: vi.fn() } });
    ctrl.handleError(error);
    ctrl.handleDisconnect();
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(onDisconnect).not.toHaveBeenCalled();
    expect(ctrl.signal.aborted).toBe(false);
  });

  it("aborts the upstream body when a consumer cancels the piped response", async () => {
    const ctrl = createStreamController();
    let upstreamAborted = false;
    const upstream = new ReadableStream({
      start(controller) {
        ctrl.signal.addEventListener("abort", () => {
          upstreamAborted = true;
          controller.error(ctrl.signal.reason);
        }, { once: true });
        controller.enqueue(new TextEncoder().encode("data: first\n\n"));
      },
    });
    const response = pipeWithDisconnect({ body: upstream }, new TransformStream(), ctrl);
    const reader = response.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: first\n\n");

    await reader.cancel("client_closed");

    expect(upstreamAborted).toBe(true);
    expect(ctrl.signal.aborted).toBe(true);
  });
});
