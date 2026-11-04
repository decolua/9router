import { NextResponse } from "next/server";
import { open } from "node:fs/promises";
import { getSettings, updateSettings } from "@/lib/localDb";
import { ready, rules, testText, eventsFile, health } from "@/lib/piiGuard/observe.js";
import { summarize } from "@/lib/piiGuard/summary.js";

export const dynamic = "force-dynamic";
const MODES = ["off", "observe", "redact", "block"];
const WHERES = ["user", "system", "assistant", "tool_result", "thinking"];
const HASH = /^[0-9a-f]{12}$/;
const MAX_IGNORE = 1000;

// Reads the newest 8 MiB; `truncated` is true when that does not reach back 24 hours.
async function recentEvents() {
  let handle;
  try {
    handle = await open(eventsFile(), "r");
    const { size } = await handle.stat();
    const length = Math.min(size, 8 * 1024 * 1024);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, size - length);
    let text = buffer.toString("utf8", 0, bytesRead);
    if (size > length) text = text.slice(text.indexOf("\n") + 1);
    const events = text.split("\n").filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean).reverse();
    const oldest = Date.parse(events.at(-1)?.ts);
    return { events, truncated: size > length && oldest > Date.now() - 24 * 60 * 60 * 1000 };
  } catch { return { events: [], truncated: false }; }
  finally { await handle?.close().catch(() => {}); }
}

async function state() {
  const settings = await getSettings();
  const available = await ready();
  const { events, truncated } = await recentEvents();
  const config = { ...settings.piiGuard, ignore: Array.isArray(settings.piiGuard?.ignore) ? settings.piiGuard.ignore : [] };
  return { enabled: !!process.env.PII_GUARD_MODULE, available, config, rules: available ? rules() : [], health: health(), summary: { ...summarize(events, { ignore: config.ignore }), truncated }, recent: events.slice(0, 20) };
}

export async function GET() {
  return NextResponse.json(await state());
}

// Body: { mode?, rules?, ignore? | ignoreMany? | ignoreRecent? (minutes), on? } saves config. { test, testMode? } scans text without saving.
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const current = (await getSettings()).piiGuard || { mode: "observe", rules: {}, ignore: [] };
  if (typeof body.test === "string") {
    if (body.test.length > 100_000) return NextResponse.json({ error: "Text too long" }, { status: 400 });
    // testMode previews one mode for every rule without saving it.
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
      const { events, truncated } = await recentEvents();
      // The log window must reach past the cutoff, or old values would look new.
      if (truncated && !(Date.parse(events.at(-1)?.ts) <= cutoff)) return NextResponse.json({ error: "Event log window too short to tell which values are new" }, { status: 409 });
      hashes = summarize(events).groups.filter(g => Date.parse(g.firstSeen) >= cutoff).map(g => g.hash);
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
  console.info(`[pii-guard] Settings changed: mode=${next.mode}, overrides=${Object.keys(next.rules).length}`);
  return NextResponse.json(await state());
}
