let intervalHandle = null;
let running = false;
const DEFAULT_INTERVAL = 10 * 60 * 1000;
const MIN_INTERVAL = 60 * 1000;

export function startBackgroundScanner({ onScan, intervalMs = DEFAULT_INTERVAL, log = console, immediate = false } = {}) {
  if (!onScan) {
    log.warn('[bg-scan] no onScan callback provided');
    return;
  }
  if (intervalHandle) {
    log.warn('[bg-scan] already running, restarting');
    stopBackgroundScanner();
  }

  const ms = Math.max(MIN_INTERVAL, intervalMs);

  if (immediate) {
    runScan(onScan, log);
  }

  intervalHandle = setInterval(() => {
    runScan(onScan, log);
  }, ms);

  const mins = Math.round(ms / 60000);
  log.info(`[bg-scan] started every ${mins}min`);
}

export function stopBackgroundScanner() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[bg-scan] stopped');
  }
}

export function isScannerRunning() {
  return intervalHandle !== null;
}

async function runScan(onScan, log) {
  if (running) {
    log.info('[bg-scan] skip — previous scan still running');
    return;
  }
  running = true;
  try {
    const t0 = Date.now();
    const result = await onScan();
    const elapsed = Date.now() - t0;
    if (result) {
      log.info(`[bg-scan] completed in ${elapsed}ms | ${result.ok || 0}/${result.total || 0} models ok`);
    } else {
      log.info(`[bg-scan] completed in ${elapsed}ms`);
    }
  } catch (err) {
    log.warn('[bg-scan] error:', err.message || String(err));
  } finally {
    running = false;
  }
}

export function getScannerStatus() {
  return {
    running,
    scheduled: intervalHandle !== null,
    intervalMs: intervalHandle ? DEFAULT_INTERVAL : 0,
  };
}
