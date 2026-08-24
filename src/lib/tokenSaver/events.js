import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";

// Truthful token-saver aggregate store. Units are NEVER mixed:
//   rtk      → characters (JavaScript string lengths)
//   headroom → proxy-reported tokens (+ true TextEncoder body bytes from diagnostics)
//   pxpipe   → estimated tokens (proxy-reported, suffix Est upstream)
// No prompts/messages/tools/identity/format/reason-text ever reach disk:
// strict allowlist below, unknown fields silently dropped.

const TOKEN_SAVER_DIR = path.join(DATA_DIR, "token-saver");
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

const SAVERS = new Set(["rtk", "headroom", "pxpipe"]);
// Bounded reason enum — only vetted labels, never free-form diagnostics text.
const REASONS = new Set(["phantom"]);

// Internal test seam: redirect storage dir / shrink rotation bound.
// Never exported as a mutable global size.
let _dirOverride = null;
let _maxFileBytesOverride = 0;
export function __setTokenSaverEventsDirForTest(dir, { maxFileBytes = 0 } = {}) {
  _dirOverride = dir || null;
  _maxFileBytesOverride = Number(maxFileBytes) > 0 ? Number(maxFileBytes) : 0;
}

function baseDir() {
  return _dirOverride || TOKEN_SAVER_DIR;
}

function bound() {
  return _maxFileBytesOverride || MAX_FILE_BYTES;
}

function eventsFile() {
  return path.join(baseDir(), "events.jsonl");
}

function rotatedFile() {
  return `${eventsFile()}.1`;
}

function ensureDir() {
  if (!fs.existsSync(baseDir())) fs.mkdirSync(baseDir(), { recursive: true });
}

function clampTs(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : Date.now();
}

// Present + finite → clamped nonnegative number; absent/non-finite → undefined.
function clampMetric(value, { integer = false } = {}) {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  const v = integer ? Math.round(n) : n;
  return v < 0 ? 0 : v;
}

// Single Node process: JS is single threaded and appends below are synchronous,
// so concurrent requests serialize naturally — no lock needed. Fail-open everywhere.
function rotateIfNeeded() {
  try {
    const file = eventsFile();
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      return; // no file yet
    }
    if (size < bound()) return;
    try {
      fs.unlinkSync(rotatedFile());
    } catch { /* no backup yet */ }
    fs.renameSync(file, rotatedFile());
  } catch { /* rotation is best-effort */ }
}

export function appendTokenSaverEvent(event) {
  try {
    if (!event || typeof event !== "object" || Array.isArray(event)) return;
    if (!SAVERS.has(event.saver)) return;
    const row = { ts: clampTs(event.ts), saver: event.saver };
    if (typeof event.applied === "boolean") row.applied = event.applied;
    const appliedCount = clampMetric(event.appliedCount, { integer: true });
    if (appliedCount !== undefined) row.appliedCount = appliedCount;
    for (const key of ["charsBefore", "charsAfter", "charsSaved"]) {
      const v = clampMetric(event[key]);
      if (v !== undefined) row[key] = v;
    }
    for (const key of ["tokensBefore", "tokensAfter", "tokensSaved", "bodyBytesBefore", "bodyBytesAfter"]) {
      const v = clampMetric(event[key]);
      if (v !== undefined) row[key] = v;
    }
    for (const key of ["tokensBeforeEst", "tokensAfterEst", "tokensSavedEst"]) {
      const v = clampMetric(event[key]);
      if (v !== undefined) row[key] = v;
    }
    const images = clampMetric(event.imageCount, { integer: true });
    if (images !== undefined) row.imageCount = images;
    const dur = clampMetric(event.durationMs);
    if (dur !== undefined) row.durationMs = dur;
    if (REASONS.has(event.reason)) row.reason = event.reason;
    ensureDir();
    rotateIfNeeded();
    fs.appendFileSync(eventsFile(), `${JSON.stringify(row)}\n`);
  } catch { /* stats must never break the request path */ }
}

export function readTokenSaverEvents() {
  const rows = [];
  for (const file of [rotatedFile(), eventsFile()]) {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev && typeof ev === "object" && !Array.isArray(ev)) rows.push(ev);
      } catch { /* skip corrupt/truncated line */ }
    }
  }
  rows.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return rows;
}

function emptyWindow() {
  return {
    requests: 0,
    applied: 0,
    bypassed: 0,
    errors: 0,
    // rtk — characters
    charsReduced: 0,
    // headroom — proxy-reported tokens + true body bytes
    proxyTokensSaved: 0,
    bodyBytesReduced: 0,
    // pxpipe — estimated tokens
    estTokensSaved: 0,
    imagesGenerated: 0,
    avgMs: 0,
  };
}

function addTo(window, row) {
  window.requests++;
  if (row.applied) window.applied++;
  else if (row.reason === "transform_error" || row.reason === "timeout") window.errors++;
  else window.bypassed++;
  if (row.saver === "rtk") window.charsReduced += row.charsSaved || 0;
  if (row.saver === "headroom") {
    window.proxyTokensSaved += row.tokensSaved || 0;
    if (
      Number.isFinite(row.bodyBytesBefore) &&
      Number.isFinite(row.bodyBytesAfter) &&
      row.bodyBytesBefore > row.bodyBytesAfter
    ) {
      window.bodyBytesReduced += row.bodyBytesBefore - row.bodyBytesAfter;
    }
  }
  if (row.saver === "pxpipe") {
    window.estTokensSaved += row.tokensSavedEst || 0;
    window.imagesGenerated += row.imageCount || 0;
  }
  if (Number.isFinite(row.durationMs) && row.durationMs > 0) {
    window._msTotal += row.durationMs;
    window._msCount++;
  }
}

// Aggregated read model: windows (all/today/yesterday/last7d/last30d), UTC daily
// timeline, recent capped at 500. Single pass over rows — no O(days × rows).
export function getTokenSaverStats({ sinceMs, timelineDays = 30, recentLimit = 100 } = {}) {
  let rows = readTokenSaverEvents();
  const since = Number(sinceMs);
  if (Number.isFinite(since) && since > 0) rows = rows.filter((r) => (r.ts || 0) >= since);

  const days = Number.isFinite(Number(timelineDays))
    ? Math.min(Math.max(Math.round(Number(timelineDays)), 1), 90)
    : 30;
  const cap = Number.isFinite(Number(recentLimit))
    ? Math.min(Math.max(Math.round(Number(recentLimit)), 0), 500)
    : 100;

  const now = Date.now();
  const startOfToday = new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();
  // Timeline is UTC-daily: anchor on the UTC midnight grid so bucket keys match
  // the ISO date of each row regardless of local offset (local midnight can fall
  // on the previous UTC day for positive offsets, dropping today's rows).
  const utcToday = Math.floor(now / DAY_MS) * DAY_MS;

  const windows = {
    all: emptyWindow(),
    today: emptyWindow(),
    yesterday: emptyWindow(),
    last7d: emptyWindow(),
    last30d: emptyWindow(),
  };
  for (const w of Object.values(windows)) {
    w._msTotal = 0;
    w._msCount = 0;
  }

  const timeline = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(utcToday - i * DAY_MS).toISOString().slice(0, 10);
    timeline.set(date, {
      date,
      requests: 0,
      compressed: 0,
      charsReduced: 0,
      proxyTokensSaved: 0,
      estTokensSaved: 0,
    });
  }

  for (const row of rows) {
    const ts = row.ts || 0;
    addTo(windows.all, row);
    if (ts >= startOfToday) addTo(windows.today, row);
    else if (ts >= startOfToday - DAY_MS) addTo(windows.yesterday, row);
    if (ts >= now - 7 * DAY_MS) addTo(windows.last7d, row);
    if (ts >= now - 30 * DAY_MS) addTo(windows.last30d, row);

    const bucket = timeline.get(new Date(ts).toISOString().slice(0, 10));
    if (bucket) {
      bucket.requests++;
      if (row.applied) {
        bucket.compressed++;
        if (row.saver === "rtk") bucket.charsReduced += row.charsSaved || 0;
        if (row.saver === "headroom") bucket.proxyTokensSaved += row.tokensSaved || 0;
        if (row.saver === "pxpipe") bucket.estTokensSaved += row.tokensSavedEst || 0;
      }
    }
  }

  for (const w of Object.values(windows)) {
    w.avgMs = w._msCount > 0 ? Math.round(w._msTotal / w._msCount) : 0;
    delete w._msTotal;
    delete w._msCount;
  }

  return {
    windows,
    timeline: [...timeline.values()],
    recent: cap > 0 ? rows.slice(-cap).reverse() : [],
  };
}
