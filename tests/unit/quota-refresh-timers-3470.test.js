import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRefreshTimers,
  nextCountdown,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/refreshTimers.js";
import {
  COUNTDOWN_SECONDS,
  REFRESH_INTERVAL_MS,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

/**
 * The quota tracker created its intervals in two places — the auto-refresh
 * effect and the `visibilitychange` handler — and each cleared only what its
 * own ref pointed at. A second start therefore orphaned the first pair, and the
 * countdown fell two seconds per second (#3470).
 *
 * `createRefreshTimers` is the single owner: `start()` stops first.
 */
function build() {
  const ticks = [];
  const refreshes = [];
  const timers = createRefreshTimers({
    onRefresh: () => refreshes.push(1),
    onTick: () => ticks.push(1),
    refreshIntervalMs: REFRESH_INTERVAL_MS,
  });
  return { timers, ticks, refreshes };
}

describe("createRefreshTimers", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ticks once per second", () => {
    const { timers, ticks } = build();
    timers.start();
    vi.advanceTimersByTime(5000);
    expect(ticks.length).toBe(5);
  });

  it("does not double the tick rate when start is called twice", () => {
    const { timers, ticks } = build();
    timers.start();
    // The hidden→visible resume used to add a second pair of intervals.
    timers.start();
    vi.advanceTimersByTime(5000);
    expect(ticks.length).toBe(5);
  });

  it("stays single-rate across a hide/show cycle", () => {
    const { timers, ticks } = build();
    timers.start();
    vi.advanceTimersByTime(2000);
    timers.stop();
    vi.advanceTimersByTime(10_000);
    expect(ticks.length).toBe(2);
    timers.start();
    vi.advanceTimersByTime(3000);
    expect(ticks.length).toBe(5);
  });

  it("stops both timers, and stop is idempotent", () => {
    const { timers, ticks, refreshes } = build();
    timers.start();
    timers.stop();
    timers.stop();
    vi.advanceTimersByTime(REFRESH_INTERVAL_MS * 2);
    expect(ticks.length).toBe(0);
    expect(refreshes.length).toBe(0);
    expect(timers.isRunning()).toBe(false);
  });

  it("refreshes on the configured interval, not on the tick", () => {
    const { timers, refreshes } = build();
    timers.start();
    vi.advanceTimersByTime(REFRESH_INTERVAL_MS - 1000);
    expect(refreshes.length).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(refreshes.length).toBe(1);
  });

  it("reports whether it is running", () => {
    const { timers } = build();
    expect(timers.isRunning()).toBe(false);
    timers.start();
    expect(timers.isRunning()).toBe(true);
    timers.stop();
    expect(timers.isRunning()).toBe(false);
  });

  it("always calls the latest callback, so a re-render need not restart it", () => {
    let current = "first";
    const seen = [];
    const timers = createRefreshTimers({
      onRefresh: () => seen.push(current),
      onTick: () => {},
      refreshIntervalMs: 1000,
    });
    timers.start();
    vi.advanceTimersByTime(1000);
    current = "second";
    vi.advanceTimersByTime(1000);
    timers.stop();
    expect(seen).toEqual(["first", "second"]);
  });
});

describe("nextCountdown", () => {
  it("counts down one second at a time", () => {
    expect(nextCountdown(60, COUNTDOWN_SECONDS)).toBe(59);
    expect(nextCountdown(2, COUNTDOWN_SECONDS)).toBe(1);
  });

  it("wraps to the full window instead of hitting zero", () => {
    expect(nextCountdown(1, COUNTDOWN_SECONDS)).toBe(COUNTDOWN_SECONDS);
    expect(nextCountdown(0, COUNTDOWN_SECONDS)).toBe(COUNTDOWN_SECONDS);
  });

  it("keeps the countdown window and the refresh interval in step", () => {
    expect(COUNTDOWN_SECONDS).toBe(REFRESH_INTERVAL_MS / 1000);
  });
});
