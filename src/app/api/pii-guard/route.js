import { NextResponse } from "next/server";
import { open } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { getSettings, updateSettings } from "@/lib/localDb";
import { ready, rules, groups, testText, eventsFile, health } from "@/lib/piiGuard/observe.js";
import { summarize } from "@/lib/piiGuard/summary.js";

export const dynamic = "force-dynamic";
const MODES = ["off", "observe", "redact", "block"];
const WHERES = ["user", "system", "assistant", "tool_result", "thinking"];
const HASH = /^[0-9a-f]{12}$/;
const MAX_IGNORE = 1000;

const CHUNK = 1 * 1024 * 1024;
const CAP = 64 * 1024 * 1024;

// ponytail: 64 MiB backward-read cap. Upgrade path: event rotation or an index.
// Module-level cache of parsed events keyed by file path, size, inode, mtime.
// On each request we read only bytes appended since the last offset; full reload
// when the file shrinks or its inode changes. Backward extension only when a
// request asks for an older `from` than the cache covers.
const cache = new Map();

async function statFile(file) {
  return stat(file);
}

async function readBytes(file, start, end) {
  const handle = await open(file, "r");
  try {
    const length = end - start;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close().catch(() => {});
  }
}

function parseLines(text) {
  return text.split("\n").filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

export async function loadEvents(fromMs) {
  const file = eventsFile();
  let st;
  try { st = await statFile(file); } catch { return { events: [], truncated: false }; }
  const inode = st.ino;
  const size = st.size;
  const mtime = st.mtimeMs;
  const key = file;
  const c = cache.get(key);

  // Full reload if no cache, inode change, or file shrink.
  let events = [];
  let truncated = false;
  let offset = 0; // bytes already covered from the start? we keep full parsed array
  let coveredFrom = Infinity; // oldest ts covered
  let bytesReadTotal = 0;

  if (!c || c.inode !== inode || size < c.size) {
    // Full backward read up to CAP or until older than fromMs
    events = [];
    let pos = size;
    let buf = "";
    let total = 0;
    let hitCap = false;
    while (pos > 0 && total < CAP) {
      const chunkSize = Math.min(CHUNK, pos, CAP - total);
      const start = pos - chunkSize;
      const text = await readBytes(file, start, pos);
      buf = text + buf;
      total += chunkSize;
      pos = start;
      // check oldest
      // parse progressively
      const lines = buf.split("\n");
      // keep first partial
      // We'll just parse at end
      if (total >= CAP) { hitCap = pos > 0; break; }
      // stop if oldest parsed event older than fromMs
      // parse tail
      const parsed = parseLines(buf);
      const oldest = parsed.length ? Date.parse(parsed[0]?.ts) : NaN;
      if (Number.isFinite(oldest) && oldest < fromMs) break;
    }
    // parse final
    let text = buf;
    if (size > total) text = text.slice(text.indexOf("\n") + 1);
    events = parseLines(text).reverse();
    // Actually we want newest-first? original recentEvents returned reversed (newest first)
    // Let's check: original: events = parsed.reverse(); oldest = events.at(-1)
    // So events newest first. parseLines returns file order (oldest first). reverse -> newest first.
    // We did parseLines(buf) where buf is file slice oldest->newest, so reverse -> newest first. Good.
    const oldestTs = events.length ? Date.parse(events[events.length-1]?.ts) : NaN;
    const readAll = total >= size;
    truncated = !readAll && Number.isFinite(oldestTs) && oldestTs > fromMs;
    coveredFrom = events.length ? Date.parse(events[events.length-1]?.ts) : fromMs;
    cache.set(key, { inode, size, mtime, events, coveredFrom, truncated, lastOffset: size, coveredStartOffset: pos, totalRead: total });
    return { events, truncated };
  }

  // Incremental append
  if (size > c.size) {
    const text = await readBytes(file, c.size, size);
    const appended = parseLines(text);
    // append in file order (oldest first) then reverse to newest-first merge
    // c.events is newest-first. New appended are newer than all existing.
    const newEvents = appended.reverse();
    events = [...newEvents, ...c.events];
    coveredFrom = c.coveredFrom;
    truncated = c.truncated;
    // If fromMs older than coveredFrom, extend backward
    if (fromMs < coveredFrom) {
      // extend
      const ext = await extendBackward(file, coveredFrom, fromMs, c);
      // merge
      // ext.events are older, prepend? events newest-first, older go to end
      events = events.concat(ext.events.filter(e => !events.includes(e)));
      coveredFrom = ext.coveredFrom;
      truncated = truncated || ext.truncated;
    }
    const _cs = (typeof ext !== 'undefined' && ext) ? ext.coveredStartOffset : c.coveredStartOffset;
    const _tr = (typeof ext !== 'undefined' && ext) ? ext.coveredStartOffset : c.coveredStartOffset;
    cache.set(key, { inode, size, mtime, events, coveredFrom, truncated, lastOffset: size, coveredStartOffset: _cs, totalRead: (c.totalRead||0)+ (size-c.size) });
    return { events, truncated };
  }

  // size same or smaller handled; if same, maybe mtime changed? use cache but check fromMs
  if (fromMs < c.coveredFrom) {
    const ext = await extendBackward(file, c.coveredFrom, fromMs, c);
    events = c.events.concat(ext.events);
    coveredFrom = ext.coveredFrom;
    truncated = c.truncated || ext.truncated;
    cache.set(key, { inode: c.inode, size: c.size, mtime, events, coveredFrom, truncated, lastOffset: c.size, coveredStartOffset: c.coveredStartOffset, totalRead: c.totalRead });
    return { events, truncated };
  }

  return { events: c.events, truncated: c.truncated };
}

async function extendBackward(file, currentOldestTs, targetFromMs, c) {
  // Read backward from currentOldest offset? We don't track offset by ts. Simpler: re-read from (currentOldest position) backward.
  // We need position of oldest covered event. Track in cache: coveredStartOffset.
  // For simplicity, track coveredStartOffset in cache.
  let startOffset = c.coveredStartOffset ?? 0;
  // if not tracked, default 0
  let pos = startOffset;
  let total = 0; // already? we extend up to CAP total additional? Keep global cap 64MiB: track totalBytesRead in cache.
  const alreadyRead = c.totalRead ?? (c.size - 0);
  let buf = "";
  let hitCap = false;
  const globalCap = CAP;
  while (pos > 0 && (alreadyRead + total) < globalCap && targetFromMs < currentOldestTs) {
    const chunkSize = Math.min(CHUNK, pos, globalCap - alreadyRead - total);
    if (chunkSize <= 0) break;
    const start = pos - chunkSize;
    const text = await readBytes(file, start, pos);
    buf = text + buf;
    total += chunkSize;
    pos = start;
    const parsed = parseLines(buf);
    const oldest = parsed.length ? Date.parse(parsed[0]?.ts) : NaN;
    if (Number.isFinite(oldest) && oldest <= targetFromMs) break;
    if ((alreadyRead + total) >= globalCap) { hitCap = pos > 0; break; }
  }
  // merge: parse buf, take events older than currentOldestTs
  const parsed = parseLines(buf).reverse(); // newest first
  // filter to those not already in cache (older than currentOldest)
  const currentOldestMs = currentOldestTs;
  const older = parsed.filter(e => Date.parse(e?.ts) < currentOldestMs);
  const oldestTs = older.length ? Date.parse(older[older.length-1]?.ts) : currentOldestTs;
  const newTruncated = hitCap && oldestTs > targetFromMs;
  return { events: older, coveredFrom: Math.min(oldestTs, currentOldestTs), coveredStartOffset: pos, totalRead: alreadyRead + total, truncated: newTruncated };
}


function validateRange(from, to) {
  if (from === undefined && to === undefined) return null;
  const f = from === undefined ? undefined : Number(from);
  const t = to === undefined ? undefined : Number(to);
  if (from !== undefined && (!Number.isInteger(f) || String(from).trim() === "")) return "bad";
  if (to !== undefined && (!Number.isInteger(t) || String(to).trim() === "")) return "bad";
  const now = Date.now();
  const fMs = from === undefined ? now - 24*60*60*1000 : f;
  const tMs = to === undefined ? now : t;
  if (!(fMs < tMs)) return "bad";
  if (tMs - fMs > 90*24*60*60*1000) return "bad";
  return { from: fMs, to: tMs };
}

async function state(fromMs, toMs) {
  const settings = await getSettings();
  const available = await ready();
  const now = Date.now();
  const from = Number.isFinite(fromMs) ? fromMs : now - 24*60*60*1000;
  const to = Number.isFinite(toMs) ? toMs : now;
  const { events, truncated } = await loadEvents(from);
  const config = { ...settings.piiGuard, ignore: Array.isArray(settings.piiGuard?.ignore) ? settings.piiGuard.ignore : [] };
  const summary = { ...summarize(events, { since: from, until: to, ignore: config.ignore }), truncated };
  // recent kept at most 20 for compat
  return { enabled: !!process.env.PII_GUARD_MODULE, available, config, rules: available ? rules() : [], groups: available ? groups() : [], health: health(), summary, recent: events.slice(0, 20) };
}

export async function GET(request) {
  const url = new URL(request.url);
  // events pagination mode
  if (url.searchParams.get("events") === "1") {
    const beforeRaw = url.searchParams.get("before");
    const limitRaw = url.searchParams.get("limit");
    let before = beforeRaw === null ? Infinity : Number(beforeRaw);
    let limit = limitRaw === null ? 50 : Number(limitRaw);
    if (beforeRaw !== null && (!Number.isInteger(before))) {
      return NextResponse.json({ error: "Bad before" }, { status: 400 });
    }
    if (!Number.isInteger(limit) || limit < 1) limit = 50;
    limit = Math.min(limit, 200);
    // range from query? use from/to if provided
    const fromMs = url.searchParams.get("from") !== null ? Number(url.searchParams.get("from")) : undefined;
    const toMs = url.searchParams.get("to") !== null ? Number(url.searchParams.get("to")) : undefined;
    const vr = validateRange(fromMs === undefined ? undefined : url.searchParams.get("from"), toMs === undefined ? undefined : url.searchParams.get("to"));
    // if from/to invalid, default last 24h
    const range = vr && vr !== "bad" ? vr : { from: Date.now() - 24*60*60*1000, to: Date.now() };
    const { events } = await loadEvents(range.from);
    // newest first already
    const filtered = events.filter(e => {
      const ts = Date.parse(e?.ts);
      return Number.isFinite(ts) && ts >= range.from && ts <= range.to && e.type !== "stats";
    });
    let page = filtered;
    if (Number.isFinite(before) && before !== Infinity) {
      page = page.filter(e => Date.parse(e?.ts) < before);
    }
    const slice = page.slice(0, limit);
    const last = slice[slice.length - 1];
    const nextBefore = slice.length === limit && last ? Date.parse(last.ts) : null;
    return NextResponse.json({ events: slice, nextBefore });
  }

  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  if (fromRaw !== null || toRaw !== null) {
    const vr = validateRange(fromRaw, toRaw);
    if (vr === "bad") return NextResponse.json({ error: "Invalid range" }, { status: 400 });
    const s = await state(vr.from, vr.to);
    return NextResponse.json(s);
  }
  // default last 24h
  const s = await state();
  return NextResponse.json(s);
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const current = (await getSettings()).piiGuard || { mode: "observe", rules: {}, ignore: [] };
  if (typeof body.test === "string") {
    if (body.test.length > 100_000) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    const config = MODES.includes(body.testMode) ? { mode: body.testMode, rules: {} } : current;
    const result = await testText(body.test, config, WHERES.includes(body.testWhere) ? body.testWhere : "user");
    return result ? NextResponse.json(result) : NextResponse.json({ error: "Scanner unavailable" }, { status: 503 });
  }
  const next = { mode: current.mode || "observe", rules: { ...(current.rules || {}) }, ignore: Array.isArray(current.ignore) ? [...current.ignore] : [] };
  if (body.ignore !== undefined) {
    if (typeof body.ignore !== "string" || !/^[0-9a-f]{12}$/.test(body.ignore) || typeof body.on !== "boolean") return NextResponse.json({ error: "Invalid ignore setting" }, { status: 400 });
    next.ignore = body.on ? [...new Set([...next.ignore, body.ignore])].slice(-1000) : next.ignore.filter(hash => hash !== body.ignore);
  }
  if (body.ignoreMany !== undefined || body.ignoreRecent !== undefined) {
    if (typeof body.on !== "boolean") return NextResponse.json({ error: "Invalid ignore setting" }, { status: 400 });
    let hashes;
    if (body.ignoreMany !== undefined) {
      if (!Array.isArray(body.ignoreMany) || body.ignoreMany.length > MAX_IGNORE || body.ignoreMany.some(h => typeof h !== "string" || !HASH.test(h))) return NextResponse.json({ error: "Invalid ignore setting" }, { status: 400 });
      hashes = body.ignoreMany;
    } else {
      if (!Number.isInteger(body.ignoreRecent) || body.ignoreRecent < 1 || body.ignoreRecent > 1440) return NextResponse.json({ error: "Invalid ignore setting" }, { status: 400 });
      const cutoff = Date.now() - body.ignoreRecent * 60_000;
      const { events, truncated } = await loadEvents(cutoff);
      if (truncated && !(Date.parse(events.at(-1)?.ts) <= cutoff)) return NextResponse.json({ error: "Event log window too short to tell which values are new" }, { status: 409 });
      hashes = summarize(events, { since: cutoff, until: Date.now() }).groups.filter(g => Date.parse(g.firstSeen) >= cutoff).map(g => g.hash);
    }
    const drop = new Set(hashes);
    if (body.on) {
      const merged = [...new Set([...next.ignore, ...hashes])];
      if (merged.length > MAX_IGNORE) return NextResponse.json({ error: "Invalid ignore setting" }, { status: 400 });
      next.ignore = merged;
    } else next.ignore = next.ignore.filter(hash => !drop.has(hash));
  }
  if (body.mode !== undefined) {
    if (!MODES.includes(body.mode)) return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    next.mode = body.mode;
  }
  if (body.rules && typeof body.rules === "object") {
    for (const [id, mode] of Object.entries(body.rules)) {
      if (!/^[a-z0-9_]{1,40}$/.test(id)) continue;
      if (mode === null || mode === "default") delete next.rules[id];
      else if (MODES.includes(mode)) next.rules[id] = mode;
    }
  }
  await updateSettings({ piiGuard: next });
  console.info(`[pii-guard] Settings changed: mode=${next.mode}, overrides=${Object.keys(next.rules).length}`);
  return NextResponse.json(await state());
}
