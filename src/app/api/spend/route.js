import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/db/driver.js";
import { getSettings, updateSettings } from "@/lib/localDb";
import { clientOf } from "@/lib/spendClient.js";

export const dynamic = "force-dynamic";

// Spend aggregates usageHistory into the numbers the Spend page shows.
// "value" = list-price cost of subscription calls (not billed); "real" = money paid
// to pay-per-token providers. Days and hours are bucketed in IST (UTC+5:30).
const IST = 5.5 * 3600e3;
const DAY = 864e5;
const SUBS = [
  { k: "claude", provider: "claude", name: "Claude Code" },
  { k: "codex", provider: "codex", name: "OpenAI Codex" },
  { k: "antigravity", provider: "antigravity", name: "Antigravity" },
  { k: "ocgo", provider: "opencode-go", name: "OpenCode Go" },
  { k: "muse", provider: "muse", name: "Muse" },
];
const SUB_OF = Object.fromEntries(SUBS.map((s) => [s.provider, s.k]));
const PAID = (p) => p === "openrouter" || p === "deepseek";
const PRESET_DAYS = { "7D": 7, "30D": 30, "60D": 60 };
const DAYKEY = /^\d{4}-\d{2}-\d{2}$/;


const dayKey = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const istMidnight = (ms) => Math.floor((ms + IST) / DAY) * DAY - IST;
const fmtDay = (ms) => new Date(ms + IST).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const hhmm = (ms) => new Date(ms + IST).toISOString().slice(11, 16);

function resolveRange(params, now, firstMs) {
  const preset = params.get("preset") || "30D";
  const today0 = istMidnight(now);
  if (preset === "Today") return { preset, hourly: true, from: today0, to: today0 + DAY };
  if (preset === "24h") { const end = Math.floor(now / 36e5) * 36e5 + 36e5; return { preset, hourly: true, from: end - DAY, to: end }; }
  if (preset === "Custom") {
    const f = params.get("from"), t = params.get("to");
    if (DAYKEY.test(f || "") && DAYKEY.test(t || "") && !Number.isNaN(Date.parse(f)) && !Number.isNaN(Date.parse(t))) {
      const a = Date.parse(f + "T00:00:00Z") - IST, b = Date.parse(t + "T00:00:00Z") - IST + DAY;
      if (b > a && a <= today0 && b - a <= 400 * DAY) return { preset, hourly: false, from: a, to: Math.min(b, today0 + DAY) };
    }
  }
  if (preset === "All") return { preset, hourly: false, from: istMidnight(Math.min(firstMs || now, now)), to: today0 + DAY };
  const n = PRESET_DAYS[preset] || 30;
  return { preset: PRESET_DAYS[preset] ? preset : "30D", hourly: false, from: today0 - (n - 1) * DAY, to: today0 + DAY };
}

function bump(map, k, init) { return map.get(k) || (map.set(k, init()), map.get(k)); }
const acc = () => ({ v: 0, real: 0, list: 0, req: 0, tok: 0 });

export async function GET(request) {
  try {
    const db = await getAdapter();
    const params = new URL(request.url).searchParams;
    const now = Date.now();
    const first = db.get(`SELECT MIN(timestamp) AS t FROM usageHistory`);
    const firstMs = first?.t ? Date.parse(first.t) : now;
    const logged = db.get(`SELECT MIN(timestamp) AS t FROM usageHistory WHERE meta LIKE '%"ua"%'`);
    const loggedSince = logged?.t ? Date.parse(logged.t) : null;
    const range = resolveRange(params, now, firstMs);

    const keyNames = new Map(db.all(`SELECT key, name FROM apiKeys`).map((r) => [r.key, r.name]));
    const rows = db.all(
      `SELECT timestamp, provider, model, apiKey, promptTokens, completionTokens, cost, meta FROM usageHistory WHERE timestamp >= ? AND timestamp < ?`,
      [new Date(range.from).toISOString(), new Date(range.to).toISOString()],
    );

    const step = range.hourly ? 36e5 : DAY;
    const nB = Math.round((range.to - range.from) / step);
    const bars = Array.from({ length: nB }, (_, i) => {
      const t = range.from + i * step;
      return {
        t, val: 0, real: 0, list: 0, subs: {},
        future: t > now,
        logged: true, // real spend comes from the cost column, known for all history
        label: range.hourly ? `${fmtDay(t)}, ${hhmm(t)}` : fmtDay(t),
        tick: range.hourly ? hhmm(t).slice(0, 2) : fmtDay(t),
      };
    });

    const byKey = new Map(), byModel = new Map(), byCombo = new Map(), byClient = new Map(), bySess = new Map(), byProv = new Map();
    const subs = Object.fromEntries(SUBS.map((s) => [s.k, 0]));
    let value = 0, real = 0, list = 0, req = 0, tok = 0, realOr = 0, realDs = 0, nrList = 0, nrReq = 0, nrTok = 0;
    const top = [];

    for (const r of rows) {
      const ms = Date.parse(r.timestamp);
      const b = bars[Math.floor((ms - range.from) / step)];
      if (!b) continue;
      let meta = {};
      if (r.meta && r.meta !== "{}") { try { meta = JSON.parse(r.meta); } catch { /* bad row */ } }
      const cost = Number(r.cost) || 0;
      const paid = PAID(r.provider);
      const rReal = Number.isFinite(meta.realCost) ? meta.realCost : paid ? cost : 0;
      const sk = SUB_OF[r.provider];
      const t = (r.promptTokens || 0) + (r.completionTokens || 0);
      b.list += cost; b.real += rReal;
      const keyName0 = keyNames.get(r.apiKey) || (r.apiKey ? "Unknown key" : "No key");
      (b.keys ||= new Map()).set(keyName0, (b.keys.get(keyName0) || 0) + cost);
      if (sk) { b.val += cost; b.subs[sk] = (b.subs[sk] || 0) + cost; subs[sk] += cost; value += cost; }
      real += rReal; list += cost; req++; tok += t;
      if (r.provider === "openrouter") realOr += rReal; else if (r.provider === "deepseek") realDs += rReal;

      const keyName = keyName0;
      const client = meta.ua !== undefined ? clientOf(meta.ua) : null;
      const role = meta.ua !== undefined ? meta.combo || "main" : null;
      const add = (m, k) => { const o = bump(m, k, () => ({ ...acc(), clients: {}, keys: {}, mix: {}, n: 0, provider: r.provider })); o.v += cost; o.real += rReal; o.req++; o.tok += t; return o; };
      const ko = add(byKey, keyName); if (client) ko.clients[client] = (ko.clients[client] || 0) + cost;
      const mo = add(byModel, r.model || "unknown"); mo.keys[keyName] = (mo.keys[keyName] || 0) + cost; if (client) mo.clients[client] = (mo.clients[client] || 0) + cost;
      add(byProv, r.provider || "unknown");
      if (client) {
        add(byCombo, role);
        const co = add(byClient, client); co.mix[r.model] = (co.mix[r.model] || 0) + cost; co.keys[keyName] = (co.keys[keyName] || 0) + cost;
        if (meta.session) {
          const s = bump(bySess, meta.session, () => ({ ...acc(), id: meta.session, client, role, key: keyName, start: ms, end: ms, models: new Map(), times: [] }));
          s.v += cost; s.real += rReal; s.req++; s.tok += t; s.start = Math.min(s.start, ms); s.end = Math.max(s.end, ms);
          if (s.times.length < 400) s.times.push(ms);
          const sm = bump(s.models, r.model, () => ({ provider: r.provider, req: 0, v: 0, real: 0 })); sm.req++; sm.v += cost; sm.real += rReal;
        }
      } else { nrList += cost; nrReq++; nrTok += t; }
      top.push({ ms, model: r.model, provider: r.provider, key: keyName, combo: meta.combo || "", client, sess: meta.session || null, tok: t, v: cost, real: rReal, logged: !!client });
    }

    const pack = (m) => [...m.entries()].map(([k, o]) => ({ k, v: o.v, real: o.real, req: o.req, tok: o.tok, n: o.n, provider: o.provider,
      clients: Object.entries(o.clients || {}).sort((a, b) => b[1] - a[1]).map((e) => e[0]),
      keys: Object.entries(o.keys || {}).sort((a, b) => b[1] - a[1]).map((e) => e[0]),
      mix: Object.entries(o.mix || {}).sort((a, b) => b[1] - a[1]) }));
    const roleCount = {};
    for (const s of bySess.values()) roleCount[s.role] = (roleCount[s.role] || 0) + 1;
    const sessions = [...bySess.values()].sort((a, b) => b.v - a.v);
    const sessOut = sessions.slice(0, 200).map((s) => ({
      id: s.id, client: s.client, role: s.role, key: s.key, start: s.start, end: s.end, startDay: fmtDay(s.start), startTime: hhmm(s.start), endTime: hhmm(s.end),
      isToday: dayKey(s.start) === dayKey(now), v: s.v, real: s.real, req: s.req, tok: s.tok,
      ticks: s.times.slice(0, 40).map((x) => (s.end > s.start ? (x - s.start) / (s.end - s.start) : 0.5)),
      models: [...s.models.entries()].sort((a, b) => b[1].v - a[1].v).map(([m, o]) => ({ m, ...o })),
    }));
    const fmtTop = (o) => ({ ...o, when: (dayKey(o.ms) === dayKey(now) ? "Today " : fmtDay(o.ms) + ", ") + hhmm(o.ms) });
    const byValue = [...top].sort((a, b) => b.v - a.v).slice(0, 10).map(fmtTop);
    const byReal = top.filter((o) => o.real > 0).sort((a, b) => b.real - a.real || b.v - a.v).slice(0, 10).map(fmtTop);
    const topSessByBar = (b) => {
      const s = sessions.filter((x) => x.start >= b.t && x.start < b.t + step)[0];
      if (!s) return null;
      const rr = [...new Set(sessions.filter((x) => x.start >= b.t && x.start < b.t + step && x.real > 0).map((x) => x.role))];
      return { key: s.key, role: s.role, id: s.id, realVia: rr };
    };
    const topBars = bars.filter((b) => !b.future).map((b) => ({ ...b, tot: b.val + b.real })).sort((a, b) => b.tot - a.tot).slice(0, 5)
      .map((b) => ({ label: b.label, val: b.val, real: b.real, tot: b.tot, logged: b.logged, top: topSessByBar(b),
        topKey: [...(b.keys || new Map()).entries()].sort((a, c) => c[1] - a[1])[0]?.[0] || null }));

    const ds30 = db.get(`SELECT SUM(cost) AS c FROM usageHistory WHERE provider = 'deepseek' AND timestamp >= ?`, [new Date(now - 30 * DAY).toISOString()]);
    const settings = await getSettings();
    return NextResponse.json({
      now, range: { ...range, first: bars[0]?.label, last: [...bars].reverse().find((b) => !b.future)?.label, days: range.hourly ? 1 : nB },
      loggedSince, loggedSinceLabel: loggedSince ? fmtDay(loggedSince) : null,
      bars: bars.map(({ t, keys, ...b }) => b),
      totals: { value, real, list, req, tok, realOr, realDs, realDs30: ds30?.c || 0, subs, nrList, nrReq, nrTok },
      allLogged: loggedSince !== null && loggedSince <= range.from,
      subsMeta: SUBS,
      fees: settings.spendFees || {},
      groups: { key: pack(byKey), model: pack(byModel), role: pack(byCombo), client: pack(byClient), provider: pack(byProv) },
      roleCount, sessionCount: sessions.length, sessionValue: sessions.reduce((a, s) => a + s.v, 0),
      sessionRest: sessions.slice(8).reduce((a, s) => ({ v: a.v + s.v, real: a.real + s.real, req: a.req + s.req, tok: a.tok + s.tok }), { v: 0, real: 0, req: 0, tok: 0 }),
      sessions: sessOut, outliers: { value: byValue, real: byReal }, topBars,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Monthly subscription fees, used for the value-per-USD ratio.
export async function PATCH(request) {
  try {
    const body = await request.json();
    const fees = {};
    for (const s of SUBS) {
      const v = body?.fees?.[s.k];
      if (v === null || v === "" || v === undefined) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100000) return NextResponse.json({ error: `Invalid fee for ${s.name}` }, { status: 400 });
      fees[s.k] = n;
    }
    await updateSettings({ spendFees: fees });
    return NextResponse.json({ fees });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
