let intervalHandle = null;
let autodiscoverHandle = null;
let running = false;
const DEFAULT_INTERVAL = 10 * 60 * 1000;
const AUTODISCOVER_INTERVAL = 60 * 60 * 1000;
const MIN_INTERVAL = 60 * 1000;

export function startBackgroundScanner({ onScan, intervalMs = DEFAULT_INTERVAL, log = console, immediate = false, onAutodiscover } = {}) {
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

  if (onAutodiscover) {
    autodiscoverHandle = setInterval(() => {
      runAutodiscover(onAutodiscover, log);
    }, AUTODISCOVER_INTERVAL);
    log.info(`[bg-scan] autodiscover started every ${AUTODISCOVER_INTERVAL / 60000}min`);
    runAutodiscover(onAutodiscover, log);
  }
}

export function stopBackgroundScanner() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (autodiscoverHandle) {
    clearInterval(autodiscoverHandle);
    autodiscoverHandle = null;
  }
  console.log('[bg-scan] stopped');
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

async function runAutodiscover(onAutodiscover, log) {
  try {
    const t0 = Date.now();
    const result = await onAutodiscover();
    const elapsed = Date.now() - t0;
    log.info(`[bg-scan] autodiscover checked ${result?.checked?.length || 0} hidden models in ${elapsed}ms (${result?.hidden || 0} total hidden)`);
  } catch (err) {
    log.warn('[bg-scan] autodiscover error:', err.message || String(err));
  }
}

export function getScannerStatus() {
  return {
    running,
    scheduled: intervalHandle !== null,
    intervalMs: intervalHandle ? DEFAULT_INTERVAL : 0,
    autodiscoverRunning: autodiscoverHandle !== null,
  };
}
