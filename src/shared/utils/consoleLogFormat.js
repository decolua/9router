/**
 * Console log parsing for the dashboard Console Log viewer.
 *
 * The server captures raw console output as text. This module turns those lines
 * into structured rows (level, tag, model, tokens, …) so the viewer can filter,
 * count and render them without regexes leaking into the component.
 *
 * Pure functions only — no React, no node APIs.
 */

export const LOG_LEVELS = ["ERROR", "WARN", "INFO", "DEBUG"];

// console.<method> captured by the buffer → display level
const CAPTURED_LEVELS = {
  error: "ERROR",
  warn: "WARN",
  info: "INFO",
  debug: "DEBUG",
  log: "INFO",
};

const TIME_RE = /^\[(\d{2}:\d{2}:\d{2})\]/;
const BRACKET_RE = /\[([^\]\n]{1,40})\]/g;
const TAG_RE = /^[A-Z][A-Z0-9_:.-]*$/;

// Leading request tag (colored dot) + status symbol, e.g. "🟢 ▶ POST …" or
// "⚠️  [BG_TOKEN_REFRESH] …". Stripped so the body starts with the message.
// An explicit symbol list is required: some glyphs (ℹ U+2139, ⚠ U+26A0) are
// Unicode letters, so a generic "non-letter" strip would leave them in place.
const LEADING_DECOR_RE = /^[\u{1F7E2}\u{1F535}\u{1F7E3}\u{1F7E1}\u{1F7E0}\u{1F534}\u{26AA}\u{1F7E4}\u{1F7E5}\u{1F7E6}\u{25B6}\u{1F4CA}\u{2699}\u{1F511}\u{2717}\u{26A1}\u{26A0}\u{1F50D}\u{1F4A5}\u{274C}\u{1F30A}\u{1F4E5}\u{1F4E4}\u{23F1}\u{23F3}\u{2139}\u{1F41B}\u{2757}\u{2753}\u{26D4}\u{FE0F}\s]+/u;

/**
 * Detect the display level of a line.
 * Explicit markers (✗ ❌ 💥 ⚠ 🔍) win over the captured console method because
 * the logger prints errors with console.log to keep them out of quiet levels.
 */
function detectLevel(text, captured) {
  const base = CAPTURED_LEVELS[captured] || "INFO";
  if (base === "ERROR") return "ERROR";
  if (/✗|❌|💥|\bERROR\b|\bFAILED\b/.test(text)) return "ERROR";
  if (base === "WARN" || /⚠/.test(text)) return "WARN";
  if (base === "DEBUG" || /🔍|\[DBG/.test(text)) return "DEBUG";
  return "INFO";
}

/** First bracketed uppercase token that is not the leading timestamp. */
function detectTag(text) {
  const withoutTime = text.replace(TIME_RE, "");
  BRACKET_RE.lastIndex = 0;
  let match;
  while ((match = BRACKET_RE.exec(withoutTime)) !== null) {
    const token = match[1];
    if (!TAG_RE.test(token)) continue;
    // [DBG:STREAM] → DBG (the part after the colon is a sub-tag, too noisy to filter on)
    return token.startsWith("DBG") ? "DBG" : token;
  }
  return null;
}

/** Trailing " · provider/model" segment when it looks like a model id. */
function detectModelSuffix(text) {
  const parts = text.split(" · ");
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1].trim();
  return /^[\w.-]+\/[\w.:/-]+$/.test(last) ? last : null;
}

/**
 * Parse one captured console entry into a structured row.
 * @param {{t?: number, level?: string, text?: string}|string} entry
 * @param {number} [index] - fallback index used for stable ids
 */
export function parseLogEntry(entry, index = 0) {
  const raw = typeof entry === "string" ? entry : entry?.text ?? "";
  const captured = typeof entry === "string" ? "log" : entry?.level ?? "log";
  const text = String(raw);
  const ts = typeof entry === "object" && entry?.t ? entry.t : Date.now();

  const timeMatch = text.match(TIME_RE);
  let body = timeMatch ? text.slice(timeMatch[0].length).trimStart() : text;
  // Drop the decorative prefix (request tag + status symbol) only when a real
  // message follows it — plain text lines must stay untouched.
  const decorMatch = body.match(LEADING_DECOR_RE);
  if (decorMatch) {
    const rest = body.slice(decorMatch[0].length).trimStart();
    if (rest) body = rest;
  }

  const requestMatch = body.match(/POST\s+(.+?)\s+→\s+([^\s·]+)/);
  const doneMatch = body.match(/\bDONE\s+(\d+)\s*ms/);
  const statusMatch = body.match(/\bERROR\s+(\d{3})\b/);
  const fmtMatch = body.match(/FMT:\s*([^·\n]+)/);
  const msgMatch = body.match(/(\d+)\s+MSG\b/);
  const toolMatch = body.match(/(\d+)\s+TOOL\b/);
  const accMatch = body.match(/ACC:([^\n·]+)/);
  const ttftMatch = body.match(/TTFT\s+(\d+)\s*ms/);
  const inMatch = body.match(/\bIN\s+(\d+)/);
  const outMatch = body.match(/\bOUT\s+(\d+)/);
  const cacheMatch = body.match(/CACHE\s+([^)]*)/);

  const cacheNumbers = cacheMatch ? (cacheMatch[1].match(/\d+/g) || []).map(Number) : [];
  const cacheRead = cacheNumbers[0] ?? 0;
  const cacheCreate = cacheNumbers[1] ?? 0;

  const level = detectLevel(text, captured);
  const kind = requestMatch
    ? "request"
    : doneMatch
      ? "done"
      : level === "ERROR"
        ? "error"
        : "log";

  return {
    // Stable key: the capture layer assigns a monotonic seq, so ids survive the
    // buffer dropping old lines (a positional index would shift and re-key rows).
    id: String(typeof entry === "object" && entry?.seq !== undefined ? entry.seq : `${ts}-${index}`),
    ts,
    time: timeMatch ? timeMatch[1] : "",
    level,
    tag: detectTag(text),
    kind,
    raw: text,
    body,
    model: requestMatch ? requestMatch[1] : null,
    routedModel: requestMatch ? requestMatch[2] : (doneMatch ? detectModelSuffix(body) : null),
    fmt: fmtMatch ? fmtMatch[1].trim() : null,
    stream: /\bSTREAM\b/.test(body) ? true : /\bJSON\b/.test(body) ? false : null,
    msgCount: msgMatch ? Number(msgMatch[1]) : null,
    toolCount: toolMatch ? Number(toolMatch[1]) : null,
    account: accMatch ? accMatch[1].trim() : null,
    totalMs: doneMatch ? Number(doneMatch[1]) : null,
    ttftMs: ttftMatch ? Number(ttftMatch[1]) : null,
    inTokens: inMatch ? Number(inMatch[1]) : null,
    cacheRead,
    cacheCreate,
    outTokens: outMatch ? Number(outMatch[1]) : null,
    status: statusMatch ? statusMatch[1] : null,
  };
}

/** Count rows per level (all levels, not only the filtered ones). */
export function countByLevel(rows) {
  const counts = { ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0 };
  for (const row of rows) {
    if (counts[row.level] !== undefined) counts[row.level] += 1;
  }
  return counts;
}

/** Tag → row count, most frequent first. */
export function collectTags(rows) {
  const counts = new Map();
  for (const row of rows) {
    if (!row.tag) continue;
    counts.set(row.tag, (counts.get(row.tag) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Apply the viewer filters (search text, level, tag) to parsed rows.
 * Search matches model, routed model, account, tag and the raw line.
 */
export function matchesLogFilters(row, { query = "", level = "ALL", tag = "ALL" } = {}) {
  if (level !== "ALL" && row.level !== level) return false;
  if (tag !== "ALL" && row.tag !== tag) return false;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [row.model, row.routedModel, row.account, row.tag, row.raw]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}
