//
// Location and retention for the raw upstream SSE frame logs written by
// `open-sse/utils/requestLogger.js`.
//
// ── Where the frames live ────────────────────────────────────────────────────────────────
// Upstream writes them to `process.cwd()/logs`. In our container that path is the image
// layer, not the mounted volume: the dumps vanish on restart — i.e. exactly when an
// incident makes you want them. We therefore write to `$DATA_DIR/logs/frames`, alongside
// the existing `$DATA_DIR/logs/mitm` (see `src/mitm/logger.js`), which is the persistent
// volume. That volume also holds `data.sqlite` — combos, provider connections, API keys —
// so filling it would not merely lose logs, it would take out the gateway's own
// configuration. A troubleshooting feature must never be able to do that, which is the
// design constraint for everything below.
//
// Three guards, all active at once:
//   1. AGE     — `observabilityRetentionHours` (default 12h). Sessions older than this go.
//   2. SIZE    — `observabilityMaxLogSizeMb` (default 512 MiB). Over budget ⇒ trim oldest
//                session first until back under. Enforced on WRITE via a running byte total
//                (`reserveFrameBytes`), not only on the timer: a periodic janitor can be
//                outrun by a burst, which is exactly the scenario that fills a disk.
//   3. FREE DISK — writing stops if the filesystem has less than
//                `OBSERVABILITY_FRAME_LOG_MIN_FREE_MB` (default 1 GiB) free.
// Hitting 2 or 3 suppresses frame writes and lets traffic carry on being served: degraded
// observability is fine, a wedged gateway is not. Suppression is logged ONCE (and once
// again when it lifts), never per request.
//
// `OBSERVABILITY_FRAME_LOG_DIR` overrides the location for operators who would rather put
// the frames on separate storage.
//
// ── Destructive-code safety ─────────────────────────────────────────────────────────────
// This module deletes directories. Every deletion is fenced by ALL of the following; if any
// check fails the prune is skipped rather than widened:
//   * the target directory is resolved to an absolute path and must not be a filesystem
//     root, the home directory, or a single-segment path;
//   * it must be a real directory (not a symlink);
//   * it must contain the marker file `.9router-frame-logs`, which only `ensureFrameLogDir()`
//     writes — so the janitor can never prune a directory this app did not create;
//   * only IMMEDIATE children are considered, only real directories (symlinks skipped), and
//     only names matching the frame-session pattern `..._YYYYMMDD_HHMMSS_mmm`;
//   * the joined child path is re-checked to be inside the target directory.
// Nothing outside the frame-log directory is ever touched.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { DATA_DIR } from "../dataDir.js";
import { MAX_RETENTION_HOURS, MIN_RETENTION_HOURS, OBSERVABILITY_DEFAULTS } from "./config.js";

/** Written into the frame-log directory; its presence is the janitor's permission slip. */
export const FRAME_LOG_MARKER_FILE = ".9router-frame-logs";

/**
 * Session folder names are `${source}_${target}_${model}_YYYYMMDD_HHMMSS_mmm`.
 * The model segment is free-form, so we anchor on the trailing timestamp only.
 */
export const FRAME_SESSION_RE = /_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(\d{3})$/;

/** Don't re-scan the directory more than this often; the janitor runs off request traffic. */
const PRUNE_THROTTLE_MS = 5 * 60 * 1000;
/** Backstop sweep so logs still expire while the router is idle or frame logging is off. */
const PRUNE_INTERVAL_MS = 30 * 60 * 1000;
/** Session folders are flat (one level of files); cap the walk anyway. */
const MAX_WALK_DEPTH = 4;
/** Start trimming at this fraction of the budget so the janitor has room before writes stop. */
const HIGH_WATER = 0.9;
/** Resume writing once usage falls back below this fraction (hysteresis, avoids flapping). */
const RESUME_WATER = 0.8;
/** Refuse to write frames when the filesystem has less than this free. */
const DEFAULT_MIN_FREE_MB = 1024;
/** How often the free-disk check actually calls statfs. */
const FREE_DISK_CHECK_MS = 30 * 1000;

/** Absolute path of the frame-log directory. Never null. */
export function getFrameLogDir() {
  const override = process.env.OBSERVABILITY_FRAME_LOG_DIR;
  if (override && String(override).trim()) return path.resolve(String(override).trim());
  return path.join(DATA_DIR, "logs", "frames");
}

/** Free-disk floor below which frame writing stops. */
export function getMinFreeDiskBytes() {
  const raw = process.env.OBSERVABILITY_FRAME_LOG_MIN_FREE_MB;
  const mb = raw === undefined || String(raw).trim() === ""
    ? DEFAULT_MIN_FREE_MB
    : Number.parseInt(String(raw).trim(), 10);
  const safeMb = Number.isFinite(mb) && mb >= 0 ? mb : DEFAULT_MIN_FREE_MB;
  return safeMb * 1024 * 1024;
}

// ── Size budget, enforced on write ──────────────────────────────────────────────────────
// `usedBytes` is a running total, so the hot path never stats the tree. It is corrected to
// the janitor's measured `keptBytes` at the end of every sweep; between sweeps it can drift
// by at most the bytes written during one sweep, which the next sweep absorbs.

let budgetBytes = OBSERVABILITY_DEFAULTS.observabilityMaxLogSizeMb * 1024 * 1024;
let usedBytes = 0;
let suppressed = false;
let suppressedReason = "";
let lastFreeDiskCheck = 0;
let lastFreeDiskOk = true;

function fmtBytes(n) {
  return n >= 1024 * 1024 ? `${Math.round(n / (1024 * 1024))} MiB` : `${n} bytes`;
}

function logOnce(message) {
  // Suppression state changes are rare by construction, so this is once per transition —
  // never once per request.
  console.warn(`[frameLogs] ${message}`);
}

function suppress(reason) {
  if (suppressed && suppressedReason === reason) return;
  suppressed = true;
  suppressedReason = reason;
  logOnce(`frame capture suppressed (${reason}). Traffic is unaffected; frames resume once there is room.`);
}

function unsuppress() {
  if (!suppressed) return;
  suppressed = false;
  suppressedReason = "";
  logOnce("frame capture resumed (back under budget).");
}

/** Point the budget at the operator's configured value. Cheap; called per request. */
export function configureFrameLogBudget({ maxLogSizeBytes } = {}) {
  if (Number.isFinite(maxLogSizeBytes) && maxLogSizeBytes > 0) budgetBytes = maxLogSizeBytes;
}

/** Current budget state — for tests and diagnostics. */
export function getFrameLogBudgetState() {
  return { budgetBytes, usedBytes, suppressed, suppressedReason };
}

/**
 * Free-disk guard. Throttled to one statfs per 30s; assumes OK when statfs is unavailable.
 */
function freeDiskOk(dir) {
  const now = Date.now();
  if (now - lastFreeDiskCheck < FREE_DISK_CHECK_MS) return lastFreeDiskOk;
  lastFreeDiskCheck = now;
  try {
    if (typeof fs.statfsSync !== "function") { lastFreeDiskOk = true; return true; }
    const st = fs.statfsSync(dir);
    lastFreeDiskOk = st.bsize * st.bavail >= getMinFreeDiskBytes();
  } catch {
    lastFreeDiskOk = true; // can't tell → don't punish the request path
  }
  return lastFreeDiskOk;
}

/**
 * Called before every frame write. Returns false when the write must be skipped.
 *
 * Crossing the high-water mark kicks a trim (oldest session first); crossing the budget
 * itself stops writing until the trim brings usage back down. Never throws, never blocks.
 */
export function reserveFrameBytes(bytes, { dir = getFrameLogDir(), retentionHours } = {}) {
  const n = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (suppressed) return false;

  usedBytes += n;

  if (usedBytes >= budgetBytes * HIGH_WATER) {
    // Trim now rather than waiting for the throttle window — a burst must not outrun us.
    scheduleFrameLogPrune({ retentionHours, dir, force: true });
  }
  if (usedBytes >= budgetBytes) {
    suppress(`size budget of ${fmtBytes(budgetBytes)} reached`);
    return false;
  }
  return true;
}

/** Free-disk gate, checked once per session rather than per write. */
export function frameDiskHasRoom(dir = getFrameLogDir()) {
  if (freeDiskOk(dir)) return true;
  suppress(`less than ${fmtBytes(getMinFreeDiskBytes())} free on the log volume`);
  return false;
}

/** Create the frame-log directory (and its marker) if needed. Returns the path, or null. */
export function ensureFrameLogDir(dir = getFrameLogDir()) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const marker = path.join(dir, FRAME_LOG_MARKER_FILE);
    if (!fs.existsSync(marker)) {
      fs.writeFileSync(
        marker,
        "9router raw upstream frame logs. Contents are pruned automatically by " +
        "src/lib/observability/frameLogs.js — do not store anything else here.\n",
      );
    }
    return dir;
  } catch (err) {
    console.log("[frameLogs] Failed to prepare frame log dir:", err?.message);
    return null;
  }
}

/** Timestamp encoded in a session folder name, or null when the name doesn't match. */
export function sessionTimestampFromName(name) {
  const m = FRAME_SESSION_RE.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  const t = new Date(
    Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(ms),
  ).getTime();
  return Number.isFinite(t) ? t : null;
}

/** True when `dir` is too dangerous to prune (root, home, single-segment path, ...). */
function isUnsafePruneTarget(dir) {
  const resolved = path.resolve(dir);
  const root = path.parse(resolved).root;
  if (resolved === root) return true;
  if (path.dirname(resolved) === resolved) return true;
  // Refuse the home directory itself (a sub-directory of it is fine).
  try {
    if (resolved === path.resolve(os.homedir())) return true;
  } catch { /* homedir() can throw in odd environments */ }
  // Require at least two segments below the root, e.g. "/logs" is refused, "/a/logs" is not.
  const rel = path.relative(root, resolved);
  if (!rel || rel.split(path.sep).filter(Boolean).length < 2) return true;
  return false;
}

async function dirSizeBytes(dir, depth = 0) {
  if (depth > MAX_WALK_DEPTH) return 0;
  let total = 0;
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSizeBytes(p, depth + 1);
    } else if (entry.isFile()) {
      try {
        total += (await fs.promises.stat(p)).size;
      } catch { /* raced with a delete */ }
    }
  }
  return total;
}

/**
 * Delete expired frame-log sessions. Age first, then oldest-first until under the byte cap.
 *
 * @param {object}  opts
 * @param {string}  opts.dir                  frame-log directory (must carry the marker file)
 * @param {number} [opts.retentionHours]      age cap
 * @param {number} [opts.maxTotalBytes]       byte budget for the whole directory
 * @param {number} [opts.now]                 injectable clock (ms) for tests
 * @returns {Promise<{skipped?:string, scanned:number, removed:string[], freedBytes:number,
 *                    keptBytes:number, errors:number}>}
 */
export async function pruneFrameLogs({
  dir,
  retentionHours = OBSERVABILITY_DEFAULTS.observabilityRetentionHours,
  maxTotalBytes = budgetBytes,
  now = Date.now(),
} = {}) {
  const report = { scanned: 0, removed: [], freedBytes: 0, keptBytes: 0, errors: 0 };

  if (!dir || typeof dir !== "string" || !dir.trim()) return { ...report, skipped: "no-dir" };
  const target = path.resolve(dir.trim());
  if (isUnsafePruneTarget(target)) return { ...report, skipped: "unsafe-path" };

  // The directory must exist, be a real directory, and be one of ours.
  try {
    const st = await fs.promises.lstat(target);
    if (!st.isDirectory()) return { ...report, skipped: "not-a-directory" };
  } catch {
    return { ...report, skipped: "missing" };
  }
  try {
    await fs.promises.access(path.join(target, FRAME_LOG_MARKER_FILE), fs.constants.F_OK);
  } catch {
    return { ...report, skipped: "no-marker" };
  }

  const hours = Math.min(Math.max(Number(retentionHours) || OBSERVABILITY_DEFAULTS.observabilityRetentionHours, MIN_RETENTION_HOURS), MAX_RETENTION_HOURS);
  const cutoff = now - hours * 60 * 60 * 1000;

  let entries;
  try {
    entries = await fs.promises.readdir(target, { withFileTypes: true });
  } catch (err) {
    return { ...report, skipped: `unreadable:${err?.code || "error"}` };
  }

  /** @type {{path:string, name:string, ts:number, bytes:number}[]} */
  const sessions = [];
  for (const entry of entries) {
    // Only real, immediate sub-directories whose name is a frame session.
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
    const ts = sessionTimestampFromName(entry.name);
    if (ts === null) continue;

    const full = path.join(target, entry.name);
    // Belt and braces: the child must still be inside the target directory.
    if (!full.startsWith(target + path.sep)) continue;

    report.scanned += 1;
    sessions.push({ path: full, name: entry.name, ts, bytes: await dirSizeBytes(full) });
  }

  const remove = async (s) => {
    try {
      await fs.promises.rm(s.path, { recursive: true, force: true });
      report.removed.push(s.name);
      report.freedBytes += s.bytes;
      return true;
    } catch (err) {
      report.errors += 1;
      console.log(`[frameLogs] Failed to remove ${s.name}:`, err?.message);
      return false;
    }
  };

  // 1. Age cap.
  const survivors = [];
  for (const s of sessions) {
    if (s.ts < cutoff) {
      if (!(await remove(s))) survivors.push(s);
    } else {
      survivors.push(s);
    }
  }

  // 2. Byte budget — oldest first.
  survivors.sort((a, b) => a.ts - b.ts);
  let kept = survivors.reduce((sum, s) => sum + s.bytes, 0);
  for (const s of survivors) {
    if (kept <= maxTotalBytes) break;
    if (await remove(s)) kept -= s.bytes;
  }
  report.keptBytes = kept;

  return report;
}

let pruneInFlight = null;
let lastPruneAt = 0;
let sweepTimer = null;

/**
 * Fire-and-forget, throttled prune. Returns immediately — never awaited by a request path.
 * Also arms a low-frequency backstop sweep so frames still expire once logging is switched
 * back off (the timer is unref'd, so it never holds the process open).
 */
export function scheduleFrameLogPrune({ retentionHours, dir = getFrameLogDir(), force = false } = {}) {
  if (!force && Date.now() - lastPruneAt < PRUNE_THROTTLE_MS) return;
  if (pruneInFlight) return;
  lastPruneAt = Date.now();
  pruneInFlight = pruneFrameLogs({ dir, retentionHours })
    .then((report) => {
      // Re-anchor the running total on the janitor's measurement, and lift suppression
      // once the trim has made room (hysteresis at RESUME_WATER so it can't flap).
      if (!report?.skipped) {
        usedBytes = report.keptBytes;
        if (suppressed && usedBytes < budgetBytes * RESUME_WATER && freeDiskOk(dir)) unsuppress();
      }
    })
    .catch((err) => console.log("[frameLogs] prune failed:", err?.message))
    .finally(() => { pruneInFlight = null; });

  if (!sweepTimer && typeof setInterval === "function") {
    sweepTimer = setInterval(() => {
      scheduleFrameLogPrune({ retentionHours, dir, force: true });
    }, PRUNE_INTERVAL_MS);
    if (typeof sweepTimer?.unref === "function") sweepTimer.unref();
  }
}

/** Test hook: resolve once any in-flight sweep has finished. */
export function __frameLogPruneSettled() {
  return pruneInFlight || Promise.resolve();
}

/** Test hook: reset throttle/sweep and budget state. */
export function __resetFrameLogPruneState() {
  if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
  pruneInFlight = null;
  lastPruneAt = 0;
  budgetBytes = OBSERVABILITY_DEFAULTS.observabilityMaxLogSizeMb * 1024 * 1024;
  usedBytes = 0;
  suppressed = false;
  suppressedReason = "";
  lastFreeDiskCheck = 0;
  lastFreeDiskOk = true;
}
