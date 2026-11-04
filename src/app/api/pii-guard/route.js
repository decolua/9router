import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { getSettings, updateSettings } from "@/lib/localDb";
import { ready, rules, testText, eventsFile } from "@/lib/piiGuard/observe.js";

export const dynamic = "force-dynamic";
const MODES = ["off", "observe", "redact", "block"];

async function recentEvents(limit = 50) {
  try {
    const lines = (await readFile(eventsFile(), "utf8")).trim().split("\n");
    return lines.slice(-limit * 2).map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(e => e && e.type !== "stats").slice(-limit).reverse();
  } catch { return []; }
}

async function state() {
  const settings = await getSettings();
  const available = await ready();
  return { enabled: !!process.env.PII_GUARD_MODULE, available, config: settings.piiGuard, rules: available ? rules() : [], events: await recentEvents() };
}

export async function GET() {
  return NextResponse.json(await state());
}

// Body: { mode?, rules? } saves config. { test, testMode? } scans text without saving.
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const current = (await getSettings()).piiGuard;
  if (typeof body.test === "string") {
    if (body.test.length > 100_000) return NextResponse.json({ error: "Text too long" }, { status: 400 });
    // testMode previews one mode for every rule without saving it.
    const config = MODES.includes(body.testMode) ? { mode: body.testMode, rules: {} } : current;
    const result = await testText(body.test, config);
    return result ? NextResponse.json(result) : NextResponse.json({ error: "Scanner unavailable" }, { status: 503 });
  }
  const next = { mode: current.mode, rules: { ...current.rules } };
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
