import { NextResponse } from "next/server";
import { clientOf } from "@/lib/spendClient.js";
import { open, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { getSettings, updateSettings } from "@/lib/localDb";
import { ready, rules, groups, testText, testImage, eventsFile, health } from "@/lib/piiGuard/observe.js";
import { summarize } from "@/lib/piiGuard/summary.js";

export const dynamic = "force-dynamic";
const MODES = ["off", "observe", "redact", "block"];
const WHERES = ["user", "system", "assistant", "tool_result", "thinking"];
const HASH = /^[0-9a-f]{12}$/;
const MAX_IGNORE = 1000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const OCR_MODES = ["off", "observe"];
const OCR_QUALITIES = ["basic", "enhanced"];
// The Next server runs from the app dir (dev: repo root; release: standalone dir), which holds public/.
const SAMPLE_DIR = join(process.cwd(), "public/pii-guard-samples");

function normalizeOcr(ocr = {}, current = {}) {
  const envQuality = process.env.PII_GUARD_OCR_MODE === "basic" ? "basic" : "enhanced";
  return {
    mode: OCR_MODES.includes(ocr.mode) ? ocr.mode : OCR_MODES.includes(current.mode) ? current.mode : "observe",
    quality: OCR_QUALITIES.includes(ocr.quality) ? ocr.quality : OCR_QUALITIES.includes(current.quality) ? current.quality : envQuality,
  };
}
async function sampleList() {
  try { return JSON.parse(await readFile(join(SAMPLE_DIR, "samples.json"), "utf8")); } catch { return []; }
}
function decodeImage(data) {
  if (typeof data !== "string" || !data || data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) return null;
  const buffer = Buffer.from(data, "base64");
  return buffer.length && buffer.length <= MAX_IMAGE_BYTES && buffer.toString("base64") === data ? buffer : null;
}

const DAY = 24 * 60 * 60 * 1000;
const MAX_DAYS = 90;
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

// Returns { events (newest first, ts >= fromMs), truncated }. truncated: the cap stopped the read before `fromMs`.
// Calls run one at a time: polls, the events pager and two tabs share one cache.
let queue = Promise.resolve();
// `visit(e)`, if given, sees events newest first and returns false to stop; no copy of the range is made.
export function loadEvents(fromMs, visit) {
  const run = queue.then(() => readEvents(fromMs, visit));
  queue = run.catch(() => {});
  return run;
}

async function readEvents(fromMs, visit) {
  const file = eventsFile();
  let handle;
  try {
    handle = await open(file, "r");
    const { ino, birthtimeMs, size } = await handle.stat();
    if (!cache || cache.file !== file || cache.ino !== ino || cache.born !== birthtimeMs || size < cache.end) {
      // Start at the last complete line; a half-written tail is read on the next call.
      const tail = await readRange(handle, Math.max(0, size - CHUNK), size);
      const end = size - (tail.length - (tail.lastIndexOf(0x0a) + 1));
      cache = { file, ino, born: birthtimeMs, start: end, end, events: [] };
    }
    if (size > cache.end) {
      const buf = await readRange(handle, cache.end, size);
      const cut = buf.lastIndexOf(0x0a) + 1;
      for (const e of parseLines(buf.subarray(0, cut))) cache.events.push(e); // no spread: a big append would overflow the call stack
      cache.end += cut;
    }
    const oldest = () => Date.parse(cache.events[0]?.ts);
    let back = CHUNK;
    while (cache.start > 0 && cache.end - cache.start < CAP && !(oldest() < fromMs)) {
      const from = Math.max(0, cache.start - back);
      const buf = await readRange(handle, from, cache.start);
      const cut = from === 0 ? 0 : buf.indexOf(0x0a) + 1; // the first line may be partial; the next round reads it whole
      if (from > 0 && cut === 0) { back *= 2; if (back > CAP) break; continue; }
      cache.events = parseLines(buf.subarray(cut)).concat(cache.events);
      cache.start = from + cut;
      back = CHUNK;
    }
    const truncated = cache.start > 0 && !(oldest() <= fromMs);
    const out = [];
    for (let i = cache.events.length - 1; i >= 0; i--) {
      const ts = Date.parse(cache.events[i].ts);
      if (ts < fromMs) break;
      if (visit) { if (visit(cache.events[i], ts) === false) break; } else out.push(cache.events[i]);
    }
    // Appends grow the cache past CAP over a long uptime; rebuild it on the next call.
    if (cache.end - cache.start > CAP * 1.5) cache = null;
    return { events: out, truncated };
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
  const fMs = from === undefined ? now - DAY : f;
  const tMs = to === undefined ? now : t;
  if (!(fMs < tMs)) return "bad";
  if (tMs - fMs > MAX_DAYS * DAY) return "bad";
  return { from: fMs, to: tMs };
}

async function state(fromMs, toMs) {
  const settings = await getSettings();
  const available = await ready();
  const now = Date.now();
  const from = Number.isFinite(fromMs) ? fromMs : now - DAY;
  const to = Number.isFinite(toMs) ? toMs : now;
  const config = { ...settings.piiGuard, ocr: normalizeOcr(settings.piiGuard?.ocr), ignore: Array.isArray(settings.piiGuard?.ignore) ? settings.piiGuard.ignore : [] };
  // Hourly buckets up to two days, else IST days.
  const IST = 5.5 * 3600e3, step = to - from <= 2 * DAY ? 3600e3 : DAY;
  const origin = step === DAY ? Math.floor((from + IST) / DAY) * DAY - IST : Math.floor(from / 3600e3) * 3600e3;
  // ponytail: one-entry summary memo. Same minute range, same log file size and same ignore list reuse the last
  // summary, so idle polls and several open tabs cost one aggregation. Health stays live. Upgrade path: incremental aggregates.
  const st = await stat(eventsFile()).catch(() => null);
  const key = `${Math.floor(from / 6e4)}|${Math.floor(to / 6e4)}|${st?.ino}|${st?.size}|${config.ignore.join(",")}`;
  let summary = memo?.key === key ? memo.summary : null;
  if (!summary) {
    const { events, truncated } = await loadEvents(from);
    summary = { ...summarize(events, { since: from, until: to, ignore: config.ignore, step, origin }), truncated, step, origin };
    memo = { key, summary };
  }
  return { enabled: !!process.env.PII_GUARD_MODULE, available, config, rules: available ? rules() : [], groups: available ? groups() : [], health: health(config), summary };
}
let memo = null;

export async function GET(request) {
  const url = new URL(request.url);
  if (url.searchParams.get("samples") === "1") return NextResponse.json(await sampleList());
  // Events pager: newest first, stats skipped. Cursor `before` (ms) + `skip` (events at exactly that ms already sent),
  // so events sharing a timestamp across a page boundary are not lost.
  if (url.searchParams.get("events") === "1") {
    const num = (k, d) => { const v = url.searchParams.get(k); return v === null ? d : Number(v); };
    const before = num("before", Infinity), skip = num("skip", 0);
    if ((before !== Infinity && !Number.isInteger(before)) || !Number.isInteger(skip) || skip < 0) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    let limit = num("limit", 50);
    if (!Number.isInteger(limit) || limit < 1) limit = 50;
    limit = Math.min(limit, 200);
    const vr = validateRange(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined);
    if (vr === "bad") return NextResponse.json({ error: "Invalid range" }, { status: 400 });
    const range = vr || { from: Date.now() - DAY, to: Date.now() };
    // Filters, same meaning in both Findings views. action "allowed" means the hash is on the allow (ignore) list now.
    const f = Object.fromEntries(["model", "client", "source", "action", "group", "q"].map((k) => [k, (url.searchParams.get(k) || "").slice(0, 200)]));
    const tests = url.searchParams.get("tests") === "1";
    const q = f.q.toLowerCase();
    const allowed = new Set(f.action === "allowed" || q ? ((await getSettings()).piiGuard?.ignore || []) : []);
    const ruleList = f.group || q ? rules() : [];
    const groupOf = Object.fromEntries(ruleList.map((r) => [r.id, r.group]));
    const labelOf = Object.fromEntries(ruleList.map((r) => [r.id, r.label || r.id]));
    const keep = (e) => (tests || !(e.type === "test" || e.test === true)) && (!f.model || e.model === f.model) && (!f.client || clientOf(e.ua || "") === f.client);
    // Allowed = allowed now, or allowed when it was logged; the row badge uses the logged action.
    const actionOk = (h) => f.action === "allowed" ? h.action === "ignored" || allowed.has(h.hash) : (h.action || "observe") === f.action;
    const text = (e, h) => [h.rule, h.name, labelOf[h.rule], h.hash, h.preview, h.source, e.model, clientOf(e.ua || "")].join(" ").toLowerCase();
    const hitOk = (e, h) => (!f.action || actionOk(h)) && (!f.source || (f.source === "ocr") === String(h.source || "").endsWith("/ocr"))
      && (!f.group || groupOf[h.rule] === f.group) && (!q || text(e, h).includes(q));
    const filtered = f.action || f.source || f.group || q;
    const page = [];
    // `seen`: events visited at timestamp `seenTs`, kept or filtered out, so the cursor skips exactly those.
    let skipped = 0, seenTs = NaN, seen = 0, lastSeen = 0;
    await loadEvents(range.from, (e, ts) => {
      if (!(ts <= range.to) || ts > before) return;
      if (ts === before && skipped < skip) { skipped++; return; }
      if (ts !== seenTs) { seenTs = ts; seen = 0; }
      seen++;
      if (e.type === "stats" || !keep(e)) return;
      const hits = filtered ? (e.hits || []).filter((h) => hitOk(e, h)) : e.hits;
      if (!hits?.length) return;
      page.push({ ...e, hits, client: clientOf(e.ua || "") });
      lastSeen = seen;
      return page.length < limit;
    });
    const last = page.at(-1);
    let next = null;
    if (page.length === limit) {
      const ts = Date.parse(last.ts);
      next = { before: ts, skip: lastSeen + (ts === before ? skip : 0) };
    }
    return NextResponse.json({ events: page, next });
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
  if (body.testImage !== undefined) {
    if (!body.testImage || typeof body.testImage !== "object" || Array.isArray(body.testImage)) return NextResponse.json({ error: "Invalid image test" }, { status: 400 });
    const samples = await sampleList();
    let buffer, sample;
    if (typeof body.testImage.sample === "string") {
      sample = samples.find(item => item?.id === body.testImage.sample);
      if (!sample || typeof sample.file !== "string" || !/^[a-z0-9_-]+\.png$/i.test(sample.file)) return NextResponse.json({ error: "Invalid sample" }, { status: 400 });
      try { buffer = await readFile(join(SAMPLE_DIR, sample.file)); } catch { return NextResponse.json({ error: "Invalid sample" }, { status: 400 }); }
      if (buffer.length > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Image too large" }, { status: 400 });
    } else {
      buffer = decodeImage(body.testImage.data);
      if (!buffer) return NextResponse.json({ error: "Invalid image data" }, { status: 400 });
    }
    if (body.testQuality !== undefined && ![...OCR_QUALITIES, "compare"].includes(body.testQuality)) return NextResponse.json({ error: "Invalid test quality" }, { status: 400 });
    if (body.testMode !== undefined && !["current", ...MODES].includes(body.testMode)) return NextResponse.json({ error: "Invalid test mode" }, { status: 400 });
    // Same as the text test: a mode preview applies to all rules.
    const config = body.testMode && body.testMode !== "current" ? { mode: body.testMode, rules: {} } : current;
    const qualities = body.testQuality === "compare" ? ["basic", "enhanced"] : [body.testQuality || normalizeOcr(current.ocr).quality];
    try {
      const results = [];
      for (const quality of qualities) {
        const result = await testImage(buffer, config, quality, { sample: sample?.id });
        if (!result) return NextResponse.json({ error: "Image OCR unavailable" }, { status: 503 });
        results.push({ mode: result.mode, status: result.status, text: result.text, chars: result.chars, meanConfidence: result.meanConfidence, ocrMs: result.ocrMs, findings: result.findings });
      }
      return NextResponse.json({ results, ...(sample && { expect: sample.expect }), note: "Images are observed only; a real request is not changed." });
    } catch { return NextResponse.json({ error: "Image OCR unavailable" }, { status: 503 }); }
  }
  if (typeof body.test === "string") {
    if (body.test.length > 100_000) return NextResponse.json({ error: "Text too long" }, { status: 400 });
    const config = MODES.includes(body.testMode) ? { mode: body.testMode, rules: {} } : current;
    const result = await testText(body.test, config, WHERES.includes(body.testWhere) ? body.testWhere : "user");
    return result ? NextResponse.json(result) : NextResponse.json({ error: "Scanner unavailable" }, { status: 503 });
  }
  const next = { mode: current.mode || "observe", rules: { ...(current.rules || {}) }, ignore: Array.isArray(current.ignore) ? [...current.ignore] : [], ocr: normalizeOcr(current.ocr), dismissed: { ...(current.dismissed || {}) } };
  // Dismissed "couldn't redact" rows: hash -> places seen when dismissed. A new place shows the row again.
  if (body.dismiss !== undefined) {
    const entries = body.dismiss && typeof body.dismiss === "object" && !Array.isArray(body.dismiss) ? Object.entries(body.dismiss) : null;
    if (!entries || entries.length > MAX_IGNORE || entries.some(([h, w]) => !HASH.test(h) || !Array.isArray(w) || w.length > 20 || w.some(x => typeof x !== "string" || x.length > 40))) return NextResponse.json({ error: "Invalid dismiss" }, { status: 400 });
    for (const [h, w] of entries) next.dismissed[h] = w;
    const keys = Object.keys(next.dismissed);
    for (const h of keys.slice(0, Math.max(0, keys.length - MAX_IGNORE))) delete next.dismissed[h];
  }
  if (body.undismiss !== undefined) {
    if (!Array.isArray(body.undismiss) || body.undismiss.length > MAX_IGNORE || body.undismiss.some(h => typeof h !== "string" || !HASH.test(h))) return NextResponse.json({ error: "Invalid dismiss" }, { status: 400 });
    for (const h of body.undismiss) delete next.dismissed[h];
  }
  if (body.ocr !== undefined) {
    if (!body.ocr || typeof body.ocr !== "object" || Array.isArray(body.ocr) || Object.keys(body.ocr).some(key => !["mode", "quality"].includes(key)) || (body.ocr.mode !== undefined && !OCR_MODES.includes(body.ocr.mode)) || (body.ocr.quality !== undefined && !OCR_QUALITIES.includes(body.ocr.quality))) return NextResponse.json({ error: "Invalid OCR setting" }, { status: 400 });
    next.ocr = normalizeOcr(body.ocr, current.ocr);
  }
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
      // Look back a full day so a value first seen before the cutoff does not count as new.
      const since = Date.now() - DAY;
      const { events, truncated } = await loadEvents(since);
      if (truncated) return NextResponse.json({ error: "Event log window too short to tell which values are new" }, { status: 409 });
      hashes = summarize(events, { since, until: Date.now() }).groups.filter(g => Date.parse(g.firstSeen) >= cutoff).map(g => g.hash);
    }
    const drop = new Set(hashes);
    if (body.on) {
      const merged = [...new Set([...next.ignore, ...hashes])];
      if (merged.length > MAX_IGNORE) return NextResponse.json({ error: `Ignore list is limited to ${MAX_IGNORE} values` }, { status: 400 });
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
  console.info(`[pii-guard] Settings changed: mode=${next.mode}, overrides=${Object.keys(next.rules).length}, dismissed=${Object.keys(next.dismissed).length}`);
  // The dashboard reloads its own range after a save, so no summary is built here.
  return NextResponse.json({ ok: true, config: next });
}
