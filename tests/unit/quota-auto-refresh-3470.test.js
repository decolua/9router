/**
 * #3470 — the Quota Tracker countdown accelerated after a visibility change.
 *
 * The tracker used to create its two intervals in two places: the auto-refresh
 * effect, and the `visibilitychange` handler's "resume" branch. The resume
 * branch overwrote `intervalRef` / `countdownRef` without clearing them first,
 * so any pair already running was orphaned — unreachable, never cleared, and
 * still calling `setCountdown`. One extra pair is one extra decrement per
 * second, which is the reported ~2x countdown.
 *
 * Measured against the old wiring (same fake timers as below): after one
 * hide/show cycle in which the effect had re-run while hidden, 10 s of ticks
 * produced 20 decrements. `createQuotaAutoRefresh` clears before it starts, so
 * the same sequence produces 10.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COUNTDOWN_INTERVAL_MS,
  REFRESH_INTERVAL_MS,
  createQuotaAutoRefresh,
} from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

/** Minimal stand-in for `document` — only `hidden` and the two listener calls. */
function fakeDocument() {
  const listeners = new Map();
  return {
    hidden: false,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
    /** Flip `hidden` and deliver the event the browser would deliver. */
    setHidden(hidden) {
      this.hidden = hidden;
      for (const fn of listeners.get("visibilitychange") ?? []) fn();
    },
    /** A visibilitychange that does not change `hidden` (browser split view). */
    dispatchVisibilityChange() {
      for (const fn of listeners.get("visibilitychange") ?? []) fn();
    },
  };
}

function setup(overrides = {}) {
  const doc = fakeDocument();
  const ticks = { count: 0 };
  const refreshes = { count: 0 };
  const timers = createQuotaAutoRefresh({
    onRefresh: () => (refreshes.count += 1),
    onTick: () => (ticks.count += 1),
    doc,
    ...overrides,
  });
  return { doc, ticks, refreshes, timers };
}

const seconds = (n) => vi.advanceTimersByTime(n * COUNTDOWN_INTERVAL_MS);

describe("quota tracker auto-refresh timers (#3470)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ticks once per second and refreshes on the refresh interval", () => {
    const { timers, ticks, refreshes } = setup();
    timers.start();

    seconds(10);
    expect(ticks.count).toBe(10);
    expect(refreshes.count).toBe(0);

    vi.advanceTimersByTime(REFRESH_INTERVAL_MS);
    expect(refreshes.count).toBe(1);

    timers.stop();
  });

  it("keeps one tick per second across a hide/show cycle", () => {
    const { doc, timers, ticks } = setup();
    timers.start();

    seconds(3);
    doc.setHidden(true);
    seconds(30); // hidden: the tracker must not poll or count down
    expect(ticks.count).toBe(3);

    doc.setHidden(false);
    seconds(10);
    expect(ticks.count).toBe(13);

    timers.stop();
  });

  it("does not stack a second countdown when 'visible' is reported twice", () => {
    const { doc, timers, ticks } = setup();
    timers.start();

    // Some browsers deliver visibilitychange without `hidden` having flipped —
    // reported from split view. Resuming twice must not double the rate.
    doc.dispatchVisibilityChange();
    doc.dispatchVisibilityChange();

    seconds(10);
    expect(ticks.count).toBe(10);

    timers.stop();
  });

  it("does not stack when start() is called on an already-running tracker", () => {
    const { timers, ticks } = setup();
    timers.start();
    timers.start();

    seconds(10);
    expect(ticks.count).toBe(10);

    timers.stop();
  });

  it("starts paused when the tab is already hidden", () => {
    const { doc, timers, ticks } = setup();
    doc.hidden = true;
    timers.start();

    seconds(10);
    expect(ticks.count).toBe(0);
    expect(timers.isRunning()).toBe(false);

    doc.setHidden(false);
    seconds(5);
    expect(ticks.count).toBe(5);

    timers.stop();
  });

  it("stop() clears the timers and unsubscribes", () => {
    const { doc, timers, ticks } = setup();
    timers.start();
    expect(doc.listenerCount("visibilitychange")).toBe(1);

    timers.stop();
    expect(timers.isRunning()).toBe(false);

    seconds(10);
    doc.setHidden(false); // a stray event after unmount must not restart anything
    seconds(10);
    expect(ticks.count).toBe(0);
    expect(doc.listenerCount("visibilitychange")).toBe(0);
  });

  it("subscribes once even if start() is repeated", () => {
    const { doc, timers } = setup();
    timers.start();
    timers.start();
    expect(doc.listenerCount("visibilitychange")).toBe(1);

    timers.stop();
    expect(doc.listenerCount("visibilitychange")).toBe(0);
  });
});
