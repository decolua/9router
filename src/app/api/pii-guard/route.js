import { NextResponse } from "next/server";
import { open } from "node:fs/promises";
import { getSettings, updateSettings } from "@/lib/localDb";
import { ready, rules, groups, testText, eventsFile, health } from "@/lib/piiGuard/observe.js";
import { summarize } from "@/lib/piiGuard/summary.js";

export const dynamic = "force-dynamic";
const MODES = ["off", "observe", "redact", "block"];
const WHERES = ["user", "system", "assistant", "tool_result", "thinking"];
const HASH = /^[0-9a-f]{12}$/;
const MAX_IGNORE = 1000;

const CHUNK = 1024 * 1024;
// ponytail: reads at most 64 MiB back (~12 days at 5 MB/day). Upgrade path: rotate events.jsonl or keep a daily index.
const CAP = 64 * 1024 * 1024;

// Parsed events, oldest first, for one file. `start` is the byte offset of the oldest parsed line,
// `end` the offset after the newest complete line. Polls read only bytes appended after `end`;
// an older `from` reads backward from `start`. A new inode or a shrunk file resets the cache.
let cache = null;

async function readRange(handle, start, end) {
  const buffer = Buffer.alloc(end - start);
  const { bytesRead } = await handle.read(buffer, 0, end - start, start);
  return buffer.subarray(0, bytesRead);
}

function parseLines(buf) {
  const out = [];
  for (const line of buf.toString("utf8").split("\n")) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

// Returns { events (newest first), truncated }. truncated: the cap stopped the read before `fromMs`.
export async function loadEvents(fromMs) {
  const file = eventsFile();
  let handle;
  try {
    handle = await open(file, "r");
    const { ino, birthtimeMs, size } = await handle.stat();
    if (!cache || cache.file !== file || cache.ino !== ino || cache.born !== birthtimeMs || size < cache.end) cache = { file, ino, born: birthtimeMs, start: size, end: size, events: [] };
    if (size > cache.end) {
      const buf = await readRange(handle, cache.end, size);
      const cut = buf.lastIndexOf(0x0a) + 1; // a half-written last line waits for the next poll
      cache.events.push(...parseLines(buf.subarray(0, cut)));
      cache.end += cut;
    }
    const oldest = () => Date.parse(cache.events[0]?.ts);
    let back = CHUNK;
    while (cache.start > 0 && cache.end - cache.start < CAP && !(oldest() < fromMs)) {
      const from = Math.max(0, cache.start - back);
      const buf = await readRange(handle, from, cache.start);
      const cut = from === 0 ? 0 : buf.indexOf(0x0a) + 1; // the first line may be partial; the next round reads it whole
      if (from > 0 && cut === 0) { back *= 2; if (back > CAP) break; continue; }
      cache.events.unshift(...parseLines(buf.subarray(cut)));
      cache.start = from + cut;
      back = CHUNK;
    }
    return { events: cache.events.slice().reverse(), truncated: cache.start > 0 && !(oldest() <= fromMs) };
  } catch { return { events: [], truncated: false }; }
  finally { await handle?.close().catch(() => {}); }
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
  return { enabled: !!process.env.PII_GUARD_MODULE, available, config, rules: available ? rules() : [], groups: available ? groups() : [], health: health(), summary };
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
