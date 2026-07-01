import os from "os";

/**
 * System specification detection utilities for auto-tuning bulk-import worker
 * concurrency. Each Playwright browser worker (Chromium/Camoufox) typically
 * consumes ~1.5-2GB RAM and 1 CPU core under load, so the defaults below stay
 * conservative to avoid swapping or thermal throttling.
 *
 * Hard limits (intentionally aligned with bulk-import managers):
 *   MIN = 1, MAX = 8
 */

const BYTES_PER_GB = 1024 * 1024 * 1024;

// Memory budget per worker. 4 GB per worker leaves headroom for the OS,
// the Next.js runtime, and the spawned browser plus its OAuth tabs.
const RAM_GB_PER_WORKER = 4;

// CPU budget per worker. We use half the logical cores so background tasks
// (OS, Next.js, browser helper processes) keep room to breathe.
const CPU_DIVISOR = 2;

const SAFE_MIN_WORKERS = 1;
const SAFE_MAX_WORKERS = 8;
const FALLBACK_WORKERS = 4;

function safeFloor(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Returns raw machine specs used for worker sizing. All values are best-effort
 * and may be 0/empty when the host blocks the underlying os APIs.
 */
export function getSystemSpecs() {
  let cpus = [];
  try {
    cpus = os.cpus() || [];
  } catch {
    cpus = [];
  }

  let totalMemBytes = 0;
  let freeMemBytes = 0;
  try {
    totalMemBytes = os.totalmem();
  } catch {
    totalMemBytes = 0;
  }
  try {
    freeMemBytes = os.freemem();
  } catch {
    freeMemBytes = 0;
  }

  const cpuCount = Array.isArray(cpus) ? cpus.length : 0;
  const cpuModel = cpus[0]?.model ? String(cpus[0].model).trim() : null;
  const totalMemGb = totalMemBytes / BYTES_PER_GB;
  const freeMemGb = freeMemBytes / BYTES_PER_GB;

  let platform = "unknown";
  let arch = "unknown";
  try {
    platform = os.platform();
  } catch {
    /* noop */
  }
  try {
    arch = os.arch();
  } catch {
    /* noop */
  }

  return {
    cpuCount,
    cpuModel,
    totalMemBytes,
    totalMemGb,
    freeMemBytes,
    freeMemGb,
    platform,
    arch,
  };
}

/**
 * Calculates the recommended bulk-import worker count for the current host
 * using a hybrid formula:
 *
 *     workers = min( floor(cpuCount / 2), floor(totalRamGb / 4) )
 *     clamped to [1, 8]
 *
 * The CPU side keeps the machine responsive; the RAM side prevents Playwright
 * from triggering swap. Whichever resource is scarcer wins. When detection
 * fails entirely we fall back to the historical default of 4.
 *
 * Returns an object so callers can also surface the decision factors in the UI.
 */
export function getRecommendedWorkerCount(specs = null) {
  const resolved = specs || getSystemSpecs();
  const { cpuCount, totalMemGb } = resolved;

  const ramBudget = safeFloor(totalMemGb / RAM_GB_PER_WORKER);
  const cpuBudget = safeFloor(cpuCount / CPU_DIVISOR);

  let limitedBy = "fallback";
  let raw = 0;

  if (ramBudget > 0 && cpuBudget > 0) {
    raw = Math.min(ramBudget, cpuBudget);
    limitedBy = ramBudget <= cpuBudget ? "ram" : "cpu";
  } else if (ramBudget > 0) {
    raw = ramBudget;
    limitedBy = "ram";
  } else if (cpuBudget > 0) {
    raw = cpuBudget;
    limitedBy = "cpu";
  } else {
    raw = FALLBACK_WORKERS;
    limitedBy = "fallback";
  }

  const recommended = clamp(raw || FALLBACK_WORKERS, SAFE_MIN_WORKERS, SAFE_MAX_WORKERS);

  return {
    recommended,
    limitedBy, // "cpu" | "ram" | "fallback"
    ramBudget,
    cpuBudget,
    minWorkers: SAFE_MIN_WORKERS,
    maxWorkers: SAFE_MAX_WORKERS,
    ramGbPerWorker: RAM_GB_PER_WORKER,
    cpuDivisor: CPU_DIVISOR,
    specs: resolved,
  };
}

/**
 * Convenience helper - returns just the integer recommendation. Used by the
 * bulk-import managers when concurrency = "auto".
 */
export function getOptimalWorkerCount() {
  return getRecommendedWorkerCount().recommended;
}

/**
 * Returns true when the supplied value (string or number) requests
 * auto-detection. We accept "auto", "Auto", "AUTO" plus boolean true.
 */
export function isAutoConcurrencyValue(value) {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  return value.trim().toLowerCase() === "auto";
}

export const SYSTEM_SPECS_CONSTANTS = Object.freeze({
  RAM_GB_PER_WORKER,
  CPU_DIVISOR,
  SAFE_MIN_WORKERS,
  SAFE_MAX_WORKERS,
  FALLBACK_WORKERS,
});
