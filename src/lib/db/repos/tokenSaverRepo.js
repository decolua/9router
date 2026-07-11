// Token Saver telemetry — aggregate-safe daily compression metrics.
//
// Stores one normalized daily aggregate per local date (YYYY-MM-DD). Designed
// to be a pure repository: it normalizes, never trusts diagnostic strings from
// chat/runtime, and is fail-open so future chat-side recording can never throw
// into the request path.
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const HEADROOM_STATES = new Set(["disabled", "compressed", "skipped"]);

// Safe diagnostic category enum — anything else maps to other-skip.
const SAFE_DIAGNOSTICS = new Set([
  "disabled",
  "missing-proxy-url",
  "timeout",
  "http-error",
  "unsupported-shape",
  "unsafe-responses-input",
  "invalid-proxy-response",
  "translation-failed",
  "unexpected-error",
  "other-skip",
]);

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "365d"]);
// 365-day retention: keep current date minus up to 364 days (i.e. 365 rows).
const RETENTION_DAYS = 365;
const RETENTION_CUTOFF_DAYS = RETENTION_DAYS - 1; // strictly before (today - 364)

function normalizeNonNegativeNum(v) {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return 0;
  return n;
}

function safeDateKey(date) {
  const d = date ? new Date(date) : new Date();
  if (Number.isNaN(d.getTime())) return localDateKey(new Date());
  return localDateKey(d);
}

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function emptyDay() {
  return {
    requestsObserved: 0,
    rtk: {
      requestsWithHits: 0,
      hits: 0,
      bytesBefore: 0,
      bytesAfter: 0,
      bytesSaved: 0,
    },
    headroom: {
      compressed: 0,
      skipped: 0,
      disabled: 0,
      tokensBefore: 0,
      tokensAfter: 0,
      tokensSaved: 0,
      bodyBytesBefore: 0,
      bodyBytesAfter: 0,
      messageBytesBefore: 0,
      messageBytesAfter: 0,
      phantomSavings: 0,
      skipReasons: {},
    },
    totals: {
      actualBytesSaved: 0,
    },
  };
}

function mapDiagnostic(diagnostic) {
  if (typeof diagnostic !== "string" || diagnostic.length === 0) return null;
  const d = diagnostic.trim();
  if (SAFE_DIAGNOSTICS.has(d)) return d;
  return "other-skip";
}

// Normalize an event into the pieces we keep. Returns null if the event should
// be dropped entirely (e.g. no headroom state).
function normalizeEvent(event) {
  if (!event || typeof event !== "object") return null;

  if (!event.headroomState || !HEADROOM_STATES.has(event.headroomState)) return null;
  const state = event.headroomState;

  const isCompression = state === "compressed";

  // For disabled/skipped, Headroom reported token/byte savings are NEVER counted.
  const headroomTokensBefore = isCompression ? normalizeNonNegativeNum(event.headroomTokensBefore) : 0;
  const headroomTokensAfter = isCompression ? normalizeNonNegativeNum(event.headroomTokensAfter) : 0;
  const headroomTokensSaved = isCompression ? normalizeNonNegativeNum(event.headroomTokensSaved) : 0;
  const headroomBodyBytesBefore = isCompression ? normalizeNonNegativeNum(event.headroomBodyBytesBefore) : 0;
  const headroomBodyBytesAfter = isCompression ? normalizeNonNegativeNum(event.headroomBodyBytesAfter) : 0;
  const headroomMessageBytesBefore = isCompression ? normalizeNonNegativeNum(event.headroomMessageBytesBefore) : 0;
  const headroomMessageBytesAfter = isCompression ? normalizeNonNegativeNum(event.headroomMessageBytesAfter) : 0;
  const headroomPhantomSavings = isCompression ? normalizeNonNegativeNum(event.headroomPhantomSavings) : 0;

  // Diagnostic category — mapped to a safe enum, never persisted raw.
  const diag = mapDiagnostic(event.headroomDiagnostic);
  let skipReasonKey = null;
  if (diag && diag !== "disabled" && diag !== "other-skip") {
    skipReasonKey = diag;
  } else if (diag === "other-skip") {
    skipReasonKey = "other-skip";
  }

  return {
    state,
    requestsObserved: normalizeNonNegativeNum(event.requestsObserved),
    rtk: {
      requestsWithHits: normalizeNonNegativeNum(event.rtkRequestsWithHits),
      hits: normalizeNonNegativeNum(event.rtkHits),
      bytesBefore: normalizeNonNegativeNum(event.rtkBytesBefore),
      bytesAfter: normalizeNonNegativeNum(event.rtkBytesAfter),
      bytesSaved: normalizeNonNegativeNum(event.rtkBytesSaved),
    },
    headroom: {
      compressed: state === "compressed" ? 1 : 0,
      skipped: state === "skipped" ? 1 : 0,
      disabled: state === "disabled" ? 1 : 0,
      tokensBefore: headroomTokensBefore,
      tokensAfter: headroomTokensAfter,
      tokensSaved: headroomTokensSaved,
      bodyBytesBefore: headroomBodyBytesBefore,
      bodyBytesAfter: headroomBodyBytesAfter,
      messageBytesBefore: headroomMessageBytesBefore,
      messageBytesAfter: headroomMessageBytesAfter,
      phantomSavings: headroomPhantomSavings,
      skipReasonKey,
    },
  };
}

function applyToDay(day, norm) {
  day.requestsObserved += norm.requestsObserved;
  day.rtk.requestsWithHits += norm.rtk.requestsWithHits;
  day.rtk.hits += norm.rtk.hits;
  day.rtk.bytesBefore += norm.rtk.bytesBefore;
  day.rtk.bytesAfter += norm.rtk.bytesAfter;
  day.rtk.bytesSaved += norm.rtk.bytesSaved;

  const h = day.headroom;
  h.compressed += norm.headroom.compressed;
  h.skipped += norm.headroom.skipped;
  h.disabled += norm.headroom.disabled;
  h.tokensBefore += norm.headroom.tokensBefore;
  h.tokensAfter += norm.headroom.tokensAfter;
  h.tokensSaved += norm.headroom.tokensSaved;
  h.bodyBytesBefore += norm.headroom.bodyBytesBefore;
  h.bodyBytesAfter += norm.headroom.bodyBytesAfter;
  h.messageBytesBefore += norm.headroom.messageBytesBefore;
  h.messageBytesAfter += norm.headroom.messageBytesAfter;
  h.phantomSavings += norm.headroom.phantomSavings;
  if (norm.headroom.skipReasonKey) {
    const k = norm.headroom.skipReasonKey;
    h.skipReasons[k] = (h.skipReasons[k] || 0) + 1;
  }

  // actualBytesSaved = rtk.bytesSaved + (bodyBytesBefore - bodyBytesAfter)
  day.totals.actualBytesSaved =
    day.rtk.bytesSaved + (day.headroom.bodyBytesBefore - day.headroom.bodyBytesAfter);
  return day;
}

function pruneOldDays(db) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_CUTOFF_DAYS);
  const cutoffKey = localDateKey(cutoff);
  // strictly before cutoffKey
  db.run(`DELETE FROM tokenSaverDaily WHERE dateKey < ?`, [cutoffKey]);
}

// Public: record a normalized Token Saver event into one daily aggregate.
// Fail-open: catches its own errors so future chat usage cannot fail.
export async function recordTokenSaverEvent(event) {
  try {
    const norm = normalizeEvent(event);
    if (!norm) return;

    const dateKey = safeDateKey(event?.dateKey);
    const db = await getAdapter();

    db.transaction(() => {
      const row = db.get(`SELECT data FROM tokenSaverDaily WHERE dateKey = ?`, [dateKey]);
      const day = row ? parseJson(row.data, emptyDay()) : emptyDay();
      applyToDay(day, norm);
      db.run(
        `INSERT INTO tokenSaverDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`,
        [dateKey, stringifyJson(day)]
      );
      pruneOldDays(db);
    });
  } catch {
    // Fail-open: never let telemetry break the caller.
  }
}

function daysInRange(db, dayCount) {
  if (!dayCount) return db.all(`SELECT dateKey, data FROM tokenSaverDaily`);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (dayCount - 1));
  const cutoffKey = localDateKey(cutoff);
  return db.all(`SELECT dateKey, data FROM tokenSaverDaily WHERE dateKey >= ?`, [cutoffKey]);
}

// Public: aggregate Token Saver stats for a period.
// Throws on invalid period (caller/route maps to 400).
export async function getTokenSaverStats(period = "7d") {
  if (!VALID_PERIODS.has(period)) {
    throw new Error(`Invalid period: ${period}`);
  }

  const db = await getAdapter();

  const periodDays = { today: 1, "24h": 1, "7d": 7, "30d": 30, "60d": 60, "365d": 365 };
  const dayCount = periodDays[period];

  const rows = daysInRange(db, dayCount);

  const agg = emptyDay();
  for (const r of rows) {
    const day = parseJson(r.data, emptyDay());
    applyToDay(agg, {
      state: "compressed", // already-aggregated, just sum fields
      requestsObserved: day.requestsObserved || 0,
      rtk: day.rtk || {},
      headroom: {
        ...day.headroom,
        compressed: day.headroom?.compressed || 0,
        skipped: day.headroom?.skipped || 0,
        disabled: day.headroom?.disabled || 0,
        tokensBefore: day.headroom?.tokensBefore || 0,
        tokensAfter: day.headroom?.tokensAfter || 0,
        tokensSaved: day.headroom?.tokensSaved || 0,
        bodyBytesBefore: day.headroom?.bodyBytesBefore || 0,
        bodyBytesAfter: day.headroom?.bodyBytesAfter || 0,
        messageBytesBefore: day.headroom?.messageBytesBefore || 0,
        messageBytesAfter: day.headroom?.messageBytesAfter || 0,
        phantomSavings: day.headroom?.phantomSavings || 0,
        skipReasonKey: null,
      },
    });
    // Re-apply skipReasons from stored aggregate
    if (day.headroom?.skipReasons) {
      for (const [k, v] of Object.entries(day.headroom.skipReasons)) {
        agg.headroom.skipReasons[k] = (agg.headroom.skipReasons[k] || 0) + (v || 0);
      }
    }
  }

  // Same body shape from repository
  return {
    requestsObserved: agg.requestsObserved,
    rtk: agg.rtk,
    headroom: agg.headroom,
    totals: agg.totals,
  };
}
