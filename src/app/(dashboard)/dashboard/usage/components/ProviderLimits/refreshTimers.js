/**
 * Ownership of the quota tracker's auto-refresh timers.
 *
 * Two places used to create these intervals — the auto-refresh effect and the
 * `visibilitychange` handler — and each only cleared what its own ref happened
 * to point at. A hidden→visible transition that raced with the effect re-running
 * left one pair orphaned and ticking forever, so the countdown dropped two
 * seconds per second (#3470).
 *
 * `start()` always stops first, so calling it twice replaces the timers instead
 * of doubling them, and there is exactly one owner no matter who calls.
 */
export function createRefreshTimers({
  onRefresh,
  onTick,
  refreshIntervalMs,
  tickMs = 1000,
}) {
  let refreshId = null;
  let tickId = null;

  const stop = () => {
    if (refreshId !== null) {
      clearInterval(refreshId);
      refreshId = null;
    }
    if (tickId !== null) {
      clearInterval(tickId);
      tickId = null;
    }
  };

  const start = () => {
    stop();
    refreshId = setInterval(() => onRefresh(), refreshIntervalMs);
    tickId = setInterval(() => onTick(), tickMs);
  };

  return {
    start,
    stop,
    isRunning: () => refreshId !== null || tickId !== null,
  };
}

/** One countdown step. Wraps back to the full window instead of hitting zero. */
export function nextCountdown(previous, windowSeconds) {
  return previous <= 1 ? windowSeconds : previous - 1;
}
