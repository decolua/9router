// Maps /api/pii-guard data onto the bindings of PII Guard.dc.html (Claude Design project f24fcbc0).
import { clientOf } from "@/lib/spendClient.js";

const IST = 5.5 * 3600e3;
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const age = (v) => {
  const ms = Date.now() - Date.parse(v);
  if (!Number.isFinite(ms)) return "—";
  if (ms < 60e3) return `${Math.max(0, Math.floor(ms / 1e3))}s ago`;
  if (ms < 36e5) return `${Math.floor(ms / 60e3)}m ago`;
  if (ms < 864e5) return `${Math.floor(ms / 36e5)}h ago`;
  return `${Math.floor(ms / 864e5)}d ago`;
};
const istDate = (ms) => new Date(ms + IST);
const dayLabel = (ms) => istDate(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const stamp = (v) => { const ms = Date.parse(v); return Number.isFinite(ms) ? `${dayLabel(ms)}, ${istDate(ms).toISOString().slice(11, 16)}` : "—"; };

// "user/tool_result" -> "User · tool result"; "/ocr" suffix kept.
export function place(src) {
  const [r, t, o] = String(src || "").split("/");
  const role = !r || r === "-" ? "Unknown" : cap(r);
  const type = !t || t === "-" ? "" : t.replace(/_/g, " ");
  return (type ? `${role} · ${type}` : role) + (o === "ocr" ? " / ocr" : "");
}

const seg = (on, c) => ({ border: 0, height: 26, padding: "0 10px", borderRadius: 7, font: "inherit", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", background: on ? "var(--segon)" : "transparent", color: on ? c || "var(--tx)" : "var(--tx2)", fontWeight: on ? 600 : 400, boxShadow: on ? "0 1px 2px rgba(0,0,0,.08)" : "none" });
const AC = { off: ["var(--seg)", "var(--tx2)"], observe: ["var(--bluebg)", "var(--blue)"], redact: ["var(--acc2)", "var(--acc)"], block: ["var(--redbg)", "var(--red)"], leaked: ["var(--redbg)", "var(--red)"], ignored: ["var(--seg)", "var(--tx3)"] };
const ACOL = { Off: "var(--tx2)", Observe: "var(--blue)", Redact: "var(--acc)", Block: "var(--red)", Default: "var(--tx)" };
const LEAK_TAG = {
  "assistant/thinking": ["Signed thinking", "Inside a signed thinking block. Editing it would break the signature, so it was sent as is."],
  key: ["JSON object key", "The value was a JSON object key. PII Guard only rewrites values."],
  number: ["Number value", "The value was a JSON number, not a string, so it could not be replaced with a placeholder."],
  body: ["Whole body", "The value was the whole request body, so it could not be rewritten in place."],
};
const SAMPLES = [["API key", "Deploy with key sk-test-FAKE9x2kQ7mZ4pL1 and ping ops@example.com if it fails."], ["Card + email", "Card 4111 1111 1111 1111 is on file for priya.s@example.com."], ["PAN + phone", "My mobile number is 9876543210 and PAN is ABCPE1234F."]];
const RANGE_SHORT = { Today: "today", "24h": "24 h", "7D": "7 days", "30D": "30 days", "60D": "60 days", All: "90 days" };

// Highlights each finding's match in `text`, in order.
function segments(text, findings) {
  const out = [];
  let pos = 0;
  for (const f of findings) {
    if (!f.match) continue;
    const at = text.indexOf(f.match, pos);
    if (at < 0) continue;
    const [bg, c] = AC[f.action] || AC.observe;
    out.push({ t: text.slice(pos, at), st: {} }, { t: f.match, st: { background: bg, color: c, borderRadius: 4, padding: "1px 3px", fontWeight: 600, boxShadow: "inset 0 -2px 0 " + c } });
    pos = at + f.match.length;
  }
  out.push({ t: text.slice(pos), st: {} });
  return out;
}

export function buildView({ data, ui, set, act, range, fit, test, events, samples }) {
  const { config = {}, health: h = {}, summary: sm = {} } = data;
  const tab = ui.tab;
  const preset = range.preset;
  const rangeShort = preset === "Custom" ? range.label : RANGE_SHORT[preset];
  const mode = config.mode || "observe";
  const overrides = config.rules || {};
  const effOf = (id) => overrides[id] || mode;
  const ruleLabel = Object.fromEntries((data.rules || []).map((r) => [r.id, r.label]));
  const ruleGroup = Object.fromEntries((data.rules || []).map((r) => [r.id, r.group]));
  const groupLabel = Object.fromEntries((data.groups || []).map((g) => [g.id, g.label]));
  const byRule = sm.byRule || {};
  const all = sm.groups || [];
  const nameOf = (v) => v.name || ruleLabel[v.rule] || v.rule;
  const gLabelOf = (v) => groupLabel[ruleGroup[v.rule]] || "Other";
  const okScanner = !!h.loaded;

  // Leaks: values that leaked at least once in the range.
  const leakVals = all.filter((v) => v.actions.includes("leaked") && !v.ignored);
  const openN = leakVals.length;
  const leaks = leakVals.map((v) => {
    const [tag, why] = LEAK_TAG[v.leakedWhere?.[0]] || ["Not rewritten", "The value matched a Redact or Block rule but sits where PII Guard cannot rewrite it."];
    const gid = ruleGroup[v.rule], glabel = groupLabel[gid] || "this rule";
    return {
      rule: nameOf(v), group: gLabelOf(v), hash: v.hash, tag, why, loc: place(v.sources[0]), time: age(v.lastSeen), first: stamp(v.firstSeen), last: stamp(v.lastSeen), hits: fmt(v.turns),
      client: clientOf(v.ua || ""), model: v.model || "—", isOpen: true, isRuled: false, expanded: ui.openLeak === v.hash,
      fix: `sets ${glabel} to Block. The next request with this value fails with HTTP 400 and a /rewind hint for the client.`,
      reviewLabel: ui.openLeak === v.hash ? "Close" : "Review",
      review: () => set((u) => ({ openLeak: u.openLeak === v.hash ? null : v.hash })),
      ignore: () => act({ ignore: v.hash, on: true }, `Marked ${nameOf(v)} #${v.hash} as a false positive.`, { ignore: v.hash, on: false }),
      blockNext: () => {
        const ids = (data.rules || []).filter((r) => r.group === gid).map((r) => r.id);
        if (!ids.length || !window.confirm(`Block every rule in ${glabel}? Requests with a new value then fail with HTTP 400.`)) return;
        act({ rules: Object.fromEntries(ids.map((id) => [id, "block"])) }, `${glabel} set to Block. Next time the client gets an error with a /rewind hint.`, { rules: Object.fromEntries(ids.map((id) => [id, overrides[id] || "default"])) });
      },
    };
  });

  const redactRules = (data.rules || []).filter((r) => effOf(r.id) === "redact").length;
  const onRules = (data.rules || []).filter((r) => effOf(r.id) !== "off").length;
  const leakWord = openN === 1 ? "value" : "values";
  const status = !h.module ? { text: "Off · PII_GUARD_MODULE is not set · requests pass unscanned", c: "var(--tx2)", bg: "var(--seg)" }
    : !okScanner ? { text: "Not protecting · scanner not loaded · requests pass unscanned", c: "var(--red)", bg: "var(--redbg)" }
    : mode === "off" && !onRules ? { text: "Off · requests are not scanned", c: "var(--tx2)", bg: "var(--seg)" }
    : openN ? { text: `Protecting · ${redactRules} rules redact · ${openN} ${leakWord} leaked in ${rangeShort}`, c: "var(--red)", bg: "var(--redbg)" }
    : { text: `Protecting · ${redactRules} rules redact · no leaks in ${rangeShort}`, c: "var(--green)", bg: "var(--greenbg)" };

  // Health problems, also counted on the Health tab dot.
  const ocr = h.ocr || {}, so = sm.ocr || {}, un = h.unscanned || {};
  const problems = [];
  if (sm.truncated) problems.push({ icon: "warning", title: "Range is cut short", desc: "The event log is longer than the read cap, so the oldest events in this range are not counted.", cta: null, bg: "var(--amberbg)", c: "var(--amber)" });
  if (!h.module) problems.push({ icon: "power_off", title: "PII_GUARD_MODULE is not set", desc: "Set it in the service drop-in and restart 9Router.", cta: null, bg: "var(--seg)", c: "var(--tx2)" });
  else if (!okScanner) problems.push({ icon: "error", title: "Scanner not loaded", desc: "Requests pass through (fail open) and are not scanned. Check the Console Log.", cta: null, bg: "var(--redbg)", c: "var(--red)" });
  if (h.errors > 0) problems.push({ icon: "error", title: `${fmt(h.errors)} scanner errors`, desc: `Last: ${h.lastError || "unknown"}. Requests fail open and are never blocked by an error.`, cta: null, bg: "var(--redbg)", c: "var(--red)" });
  if ((so.status?.partial || 0) > 0) problems.push({ icon: "image_not_supported", title: `${fmt(so.status.partial)} images only partly read`, desc: "Low-resolution screenshots. Enhanced quality reads more of them, at about 3× the time.", cta: ocr.quality === "basic" ? "Try Enhanced" : null, onCta: () => act({ ocr: { quality: "enhanced" } }), bg: "var(--amberbg)", c: "var(--amber)" });
  if (so.reasons?.queue_full) problems.push({ icon: "info", title: `OCR queue overflowed ${fmt(so.reasons.queue_full)} times`, desc: "Information only. Those images were sent without being scanned; they count in “Images not scanned”.", cta: null, bg: "var(--bluebg)", c: "var(--blue)" });
  const issues = problems.length;
  const health = issues ? { text: `Scanner: ${issues} ${issues === 1 ? "issue" : "issues"}`, c: !okScanner ? "var(--red)" : "var(--amber)", bg: !okScanner ? "var(--redbg)" : "var(--amberbg)" } : { text: "Scanner OK", c: "var(--green)", bg: "var(--greenbg)" };

  const found = fmt(sm.unique24h);
  const tabs = [["overview", "Overview"], ["findings", "Findings", found], ["rules", "Rules"], ["test", "Test"], ["health", "Health", null, issues ? health.c : null]]
    .map(([k, label, count, dot]) => ({ label, count, dot, on: () => set({ tab: k }), style: { ...seg(tab === k), height: 32, padding: "0 12px", fontSize: 13, display: "flex", alignItems: "center", gap: 6, background: tab === k ? "var(--card)" : "transparent", boxShadow: tab === k ? "0 0 0 1px var(--line2)" : "none" } }));

  // Trend: one bar per hour (≤ 2 days) or IST day.
  const trend = sm.trend || [];
  const hourly = sm.step === 36e5;
  const vmx = Math.max(1, ...trend.map((b) => b.hits));
  const every = Math.ceil(trend.length / 8) || 1;
  const fbars = trend.map((b, i) => {
    const t = sm.origin + i * sm.step;
    return { h: (b.hits / vmx) * 100 + "%", op: 0.75, leak: b.leaks > 0, tick: i % every ? "" : hourly ? istDate(t).toISOString().slice(11, 13) + ":00" : dayLabel(t), title: `${hourly ? stamp(new Date(t).toISOString()) : dayLabel(t)} · ${fmt(b.hits)} hits` };
  });
  const totalHits = Object.values(sm.bySource || {}).reduce((a, n) => a + n, 0);
  const ah = sm.actionHits || {};
  const n = {
    found, foundHits: fmt(totalHits) + " hits",
    redacted: fmt(all.filter((v) => v.action === "redact").length), redactedHits: fmt(ah.redact) + " hits",
    blocked: fmt(sm.blocked24h), blockedHits: fmt(ah.block) + " hits",
  };

  const locAll = Object.entries(sm.bySource || {}).sort((a, b) => b[1] - a[1]);
  const maxLoc = locAll[0]?.[1] || 1;
  const locs = (ui.allLoc ? locAll : locAll.slice(0, 5)).map(([s, c]) => ({ name: place(s), hits: fmt(c), w: Math.max(0.6, (c / maxLoc) * 100) + "%" }));
  const clients = new Map();
  for (const v of all) {
    const c = clientOf(v.ua || "");
    const o = clients.get(c) || { values: 0, leaks: 0, models: {} };
    o.values++; if (v.actions.includes("leaked") && !v.ignored) o.leaks++;
    if (v.model) o.models[v.model] = (o.models[v.model] || 0) + 1;
    clients.set(c, o);
  }
  const cl = [...clients.entries()].sort((a, b) => b[1].values - a[1].values);
  const byClient = cl.map(([name, o]) => ({ name, sub: Object.entries(o.models).sort((a, b) => b[1] - a[1])[0]?.[0] || "—", values: fmt(o.values), w: (o.values / (cl[0]?.[1].values || 1)) * 100 + "%", leaks: String(o.leaks), lc: o.leaks ? "var(--red)" : "var(--tx3)" }));

  // Rules
  const confirmBlock = (a) => a !== "Block" || window.confirm("Block rejects requests with HTTP 400 the first time a new value appears. Continue?");
  const globalBtns = ["Off", "Observe", "Redact", "Block"].map((a) => ({ label: a, style: seg(mode === a.toLowerCase(), ACOL[a]), on: () => confirmBlock(a) && act({ mode: a.toLowerCase() }) }));
  const ocrOn = !!ocr.available;
  const ocrCfg = config.ocr || {};
  const ocrDef = [["mode", "Image OCR", ["Off", "Observe"], ocrOn ? "Reads text inside images. Findings are logged only; images are never changed." : "Set PII_GUARD_OCR=1 in the service drop-in to enable image OCR."],
    ["quality", "OCR quality", ["Basic", "Enhanced"], "Enhanced reads small and rotated text. About 3× slower per image."],
    ["keep", "Keep images", null, ocr.capture ? "On: set by PII_GUARD_CAPTURE_IMAGES. Kept 14 days for OCR replay; backups skip them." : "Off: set PII_GUARD_CAPTURE_IMAGES=1 in the service drop-in."]];
  const ocrRows = ocrDef.map(([k, label, opts, desc]) => ({ label, desc, hasBtns: !!opts, ro: opts ? null : ocr.capture ? "On" : "Off",
    btns: (opts || []).map((o) => ({ label: o, style: { ...seg((ocrCfg[k] || "") === o.toLowerCase()), ...(ocrOn ? {} : { opacity: 0.5, cursor: "not-allowed" }) }, on: () => ocrOn && act({ ocr: { [k]: o.toLowerCase() } }) })) }));
  const groups = (data.groups || []).map((g) => {
    const rs = (data.rules || []).filter((r) => r.group === g.id);
    const set1 = new Set(rs.map((r) => overrides[r.id] || "default"));
    const cur = set1.size === 1 ? cap([...set1][0]) : null;
    const hits = rs.reduce((a, r) => a + (byRule[r.id]?.hits || 0), 0), uniq = rs.reduce((a, r) => a + (byRule[r.id]?.unique || 0), 0);
    const open = ui.openGroup === g.id;
    return {
      name: g.label, ruleCount: rs.length, uniq: fmt(uniq), hits: fmt(hits), open, chev: open ? "expand_more" : "chevron_right",
      differs: cur !== "Default", badge: cur ? `Overrides default (${cap(mode)})` : "Mixed rule actions",
      toggle: () => set((u) => ({ openGroup: u.openGroup === g.id ? null : g.id })),
      rules: rs.map((r) => ({ name: r.label, hits: fmt(byRule[r.id]?.hits) })),
      btns: ["Default", "Off", "Observe", "Redact", "Block"].map((a) => ({ label: a, style: seg(cur === a, ACOL[a]), on: () => confirmBlock(a) && act({ rules: Object.fromEntries(rs.map((r) => [r.id, a.toLowerCase()])) }) })),
    };
  });

  // Findings
  const q = ui.q.toLowerCase();
  const rows = all.filter((v) => (ui.fStatus === "ignored" ? v.ignored : ui.fStatus === "leaked" ? v.actions.includes("leaked") && !v.ignored : !v.ignored)
    && (!ui.fGroup || gLabelOf(v) === ui.fGroup) && (!ui.fAction || v.action === ui.fAction) && (!ui.fClient || clientOf(v.ua || "") === ui.fClient)
    && (!ui.fModel || v.model === ui.fModel) && (!ui.fSource || (ui.fSource === "ocr") === v.sources.some((s) => s.endsWith("/ocr")))
    && (!q || `${nameOf(v)} ${gLabelOf(v)} ${v.hash} ${v.model || ""}`.toLowerCase().includes(q)));
  const shown = rows.slice(0, ui.limit);
  const selKeys = Object.keys(ui.sel).filter((k) => ui.sel[k]);
  const values = shown.map((v) => {
    const w = v.sources.map(place);
    return {
      name: nameOf(v), group: gLabelOf(v), hash: v.hash, leaked: v.actions.includes("leaked"), where: w.slice(0, 2).join(", ") + (w.length > 2 ? ` +${w.length - 2}` : ""),
      client: clientOf(v.ua || ""), key: "", model: v.model || "—", sess: "—", sessTip: "Session not recorded by PII Guard",
      action: cap(v.action), abg: (AC[v.action] || AC.observe)[0], ac: (AC[v.action] || AC.observe)[1], last: age(v.lastSeen), first: age(v.firstSeen), hits: fmt(v.turns),
      sel: !!ui.sel[v.hash], bg: ui.sel[v.hash] ? "var(--acc2)" : "transparent",
      toggle: () => set((u) => ({ sel: { ...u.sel, [v.hash]: !u.sel[v.hash] } })),
      ignoreLabel: v.ignored ? "Restore" : "Ignore", ignore: () => act({ ignore: v.hash, on: !v.ignored }),
    };
  });
  const selRules = [...new Set(all.filter((v) => ui.sel[v.hash]).map((v) => v.rule))];
  const setAct = (a) => () => { if (window.confirm(`Set ${selRules.length} ${selRules.length === 1 ? "rule" : "rules"} to ${cap(a)}? This changes every value of ${selRules.length === 1 ? "that rule" : "those rules"}, not only the selected ones.${a === "block" ? " Block rejects requests with HTTP 400 the first time a new value appears." : ""}`)) { act({ rules: Object.fromEntries(selRules.map((r) => [r, a])) }); set({ sel: {} }); } };
  const opts = (f) => [...new Set(all.map(f).filter(Boolean))].sort();

  // Test
  const tr = test.result, ir = test.image?.results?.[0];
  const isImg = ui.testKind === "image", imgOff = !ocrOn || ocrCfg.mode === "off";
  const hitRow = (f) => ({ rule: f.name || ruleLabel[f.rule] || f.rule, group: groupLabel[ruleGroup[f.rule]] || "Other", hash: String(f.hash).slice(0, 6), action: cap(f.action), abg: (AC[f.action] || AC.observe)[0], ac: (AC[f.action] || AC.observe)[1] });
  const tHits = (isImg ? ir?.findings : tr?.findings) || [];
  const blocked = !isImg && tr?.blocked?.length > 0;
  const nR = tHits.filter((f) => f.action === "redact").length, nO = tHits.filter((f) => f.action === "observe").length;
  const textVerdict = test.error ? { text: test.error, bg: "var(--redbg)", c: "var(--red)" } : !tr ? { text: "Scanning…", bg: "var(--seg)", c: "var(--tx2)" } : blocked ? { text: "Request blocked", bg: "var(--redbg)", c: "var(--red)" } : !tHits.length ? { text: "Nothing found", bg: "var(--greenbg)", c: "var(--green)" } : { text: `${nR} redacted · ${nO} observed`, bg: nO ? "var(--bluebg)" : "var(--acc2)", c: nO ? "var(--blue)" : "var(--acc)" };
  const imgVerdict = imgOff ? { text: "Image OCR is Off", bg: "var(--seg)", c: "var(--tx2)" } : test.error ? { text: test.error, bg: "var(--redbg)", c: "var(--red)" } : test.busy || !ir ? { text: "Reading image…", bg: "var(--seg)", c: "var(--tx2)" } : tHits.length ? { text: `${tHits.length} observed · image unchanged`, bg: "var(--bluebg)", c: "var(--blue)" } : { text: "Nothing found", bg: "var(--greenbg)", c: "var(--green)" };
  const sample = samples[ui.imgSel] || null;
  const testOut = isImg ? (imgOff ? "Image OCR is Off. The image is sent unchanged and not scanned." : `The original image, unchanged. ${tHits.length} ${tHits.length === 1 ? "finding" : "findings"} logged as hashes only.`)
    : blocked ? "— Request rejected with HTTP 400. Nothing is sent to the model. —" : tr ? String(tr.redacted ?? tr.before ?? "") : "";

  // Health
  const p95 = h.p95ScanMs ? `p95 ${fmt(h.p95ScanMs)} ms` : "—";
  const up = (() => { const s = (Date.now() - Date.parse(h.since)) / 1e3; return !Number.isFinite(s) ? "—" : s < 3600 ? `${Math.floor(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h` : `${Math.floor(s / 86400)} d`; })();
  const metrics = [["Scanner errors", fmt(h.errors), "fails open, never blocks", h.errors ? "var(--red)" : null], ["Requests scanned", fmt(h.requests), `${fmt(h.withFindings)} with findings`], ["Scan latency", p95, h.maxScanMs ? `max ${fmt(h.maxScanMs)} ms` : ""],
    ["Known values", fmt(h.knownCount), h.knownUpdated ? `updated ${age(h.knownUpdated)}` : ""], ["Images not scanned", fmt(un.images), ocr.enabled ? "queue full or unreadable" : "OCR off", un.images ? "var(--amber)" : null], ["Files not scanned", fmt(un.files), ""],
    ["Encrypted reasoning skipped", fmt(un.opaque), "cannot be read"], ["Uptime", up, `${fmt(h.seen)} values seen`]]
    .map(([label, value, sub, c]) => ({ label, value, sub, c: c || "var(--tx)" }));
  const st = so.status || {};
  const ocrStats = [["Images scanned", fmt(so.totalImages), `${fmt(so.imagesWithHits)} with hits`], ["Read OK", fmt(st.scanned), `${fmt(st.partial)} partial · ${fmt(st.empty)} empty · ${fmt(st.skipped)} skipped`],
    ["Cache hit rate", Math.round((so.cacheHitRate || 0) * 100) + "%", `${fmt(so.cache?.hit)} hit · ${fmt(so.cache?.miss)} miss`], ["OCR latency", so.p95OcrMs ? `p95 ${fmt(so.p95OcrMs)} ms` : "—", "on cache misses"]].map(([label, value, sub]) => ({ label, value, sub }));
  const imgGroups = [];
  for (const r of so.recent || []) {
    const hit = r.rules?.length > 0, kind = r.status === "skipped" ? "skipped" : hit ? "hit" : "no hits";
    const last = imgGroups.at(-1);
    if (last && last.model === (r.model || "—") && last.kind === kind) { last.n++; last.oldest = r.ts; continue; }
    imgGroups.push({ model: r.model || "—", kind, n: 1, newest: r.ts, oldest: r.ts, rules: r.rules || [], reason: r.reason, cache: r.cache, mode: r.mode });
  }

  return {
    status, health, tabs, rangeShort, okScanner,
    s: { leaks: tab === "overview", numbers: tab === "overview", where: tab === "overview", wording: tab === "rules", mode: tab === "rules", groups: tab === "rules", values: tab === "findings", test: tab === "test", health: tab === "health", ocr: tab === "health" },
    goLeaks: () => set({ tab: "overview" }), goHealth: () => set({ tab: "health" }),
    leaks, noLeaks: leaks.length === 0, leakCount: openN ? `${openN} open` : "", leakBorder: openN ? "var(--red)" : "var(--line)", leakIcon: openN ? "gpp_bad" : "gpp_good",
    n, trendTitle: hourly ? "FINDINGS PER HOUR (IST)" : "FINDINGS PER DAY (IST)", fbars, fgap: trend.length > 40 ? "1px" : "3px",
    locs, toggleLoc: () => set((u) => ({ allLoc: !u.allLoc })), locBtn: ui.allLoc ? "Show top 5" : `Show all ${locAll.length}`, byClient,
    redactRules, globalBtns, piiEx: "{{pii:email#4b7538}}", ocrRows, groups,
    subTabs: [["values", "Values"], ["events", "Event log"]].map(([k, label]) => ({ label, style: seg(ui.sub === k), on: () => set({ sub: k }) })),
    isValues: ui.sub === "values", isEvents: ui.sub === "events",
    shownLabel: ui.sub === "values" ? `${shown.length} of ${fmt(all.length)} values` : `Latest ${events.length} events`,
    groupOpts: opts(gLabelOf), clientOpts: opts((v) => clientOf(v.ua || "")), modelOpts: opts((v) => v.model),
    hasSel: selKeys.length > 0, selCount: selKeys.length, allSel: values.length > 0 && values.every((v) => v.sel),
    toggleAll: () => set({ sel: values.every((v) => v.sel) ? {} : Object.fromEntries(values.map((v) => [v.hash, true])) }),
    bulkIgnore: () => { act({ ignoreMany: selKeys, on: true }); set({ sel: {} }); }, bulkObserve: setAct("observe"), bulkRedact: setAct("redact"), bulkBlock: setAct("block"),
    copyHashes: () => navigator.clipboard?.writeText(selKeys.join("\n")),
    values, noValues: values.length === 0, moreValues: rows.length > shown.length ? () => set((u) => ({ limit: u.limit + 300 })) : null, moreLabel: `Show ${Math.min(300, rows.length - shown.length)} more`,
    events: events.map((e) => ({ ...e, abg: (AC[e.a] || AC.observe)[0], ac: (AC[e.a] || AC.observe)[1], action: cap(e.a), rule: e.name || ruleLabel[e.rule] || e.rule })),
    samples: SAMPLES.map(([label, t]) => ({ label, on: () => set({ testText: t }) })),
    kindBtns: [["text", "Text"], ["image", "Image"]].map(([k, label]) => ({ label, style: seg(ui.testKind === k), on: () => set({ testKind: k }) })),
    isText: !isImg, isImage: isImg,
    testSegs: tr ? segments(String(tr.before ?? ""), tr.findings || []) : [{ t: ui.testText, st: {} }],
    imgSegs: ir ? segments(String(ir.text || ""), ir.findings || []) : [{ t: imgOff ? "—" : "Reading…", st: {} }],
    testHits: tHits.map(hitRow), noTestHits: tHits.length === 0,
    noHitsText: isImg ? (imgOff ? "Image OCR is Off, so nothing was read." : "Nothing found in the OCR text.") : "Nothing found. The text would be sent unchanged.",
    testVerdict: isImg ? imgVerdict : textVerdict, testOut,
    thumbs: samples.map((x, i) => ({ short: x.label.split(/,| with | and /)[0], name: x.label, on: () => set({ imgSel: i, upload: null }),
      style: { height: 58, border: 0, borderRadius: 8, cursor: "pointer", background: `center / cover no-repeat url(/pii-guard-samples/${x.file}), var(--seg)`, outline: !ui.upload && ui.imgSel === i ? "2px solid var(--acc)" : "1px solid var(--line2)", outlineOffset: -1, display: "flex", alignItems: "flex-end", justifyContent: "flex-start", padding: 4, color: "var(--tx)", fontSize: 10.5, fontWeight: 600, textShadow: "0 0 3px var(--card)", overflow: "hidden" } })),
    hasUpload: !!ui.upload, hasSample: !ui.upload && !!sample, imgBg: ui.upload ? `center / contain no-repeat url(${ui.upload.url})` : "none", imgName: ui.upload?.name || "",
    sampleName: sample?.label || "", sampleBg: sample ? `center / contain no-repeat url(/pii-guard-samples/${sample.file})` : "none",
    problems, noProblems: problems.length === 0, metrics, ocrStats,
    healthNote: okScanner ? `Scanner loaded · up ${up}` : "Scanner not loaded",
    ocrNote: ocrOn ? `${cap(ocrCfg.mode || "observe")} · ${ocrCfg.quality || "basic"} quality` : "OCR not enabled",
    imgGroups: imgGroups.map((g) => ({ model: g.model, count: `${g.n} ${g.n === 1 ? "image" : "images"}`, status: g.kind === "hit" ? `${g.rules.length} ${g.rules.length === 1 ? "hit" : "hits"}` : g.kind,
      detail: g.kind === "hit" ? g.rules.join(", ") : g.kind === "skipped" ? (g.reason || "skipped").replace(/_/g, " ") : `${g.cache === "hit" ? "from cache" : "scanned"} · ${g.mode || "basic"}`,
      when: g.n > 1 && g.oldest !== g.newest ? `${age(g.oldest).replace(" ago", "")}–${age(g.newest)}` : age(g.newest),
      bg: g.kind === "hit" ? "var(--redbg)" : g.kind === "skipped" ? "var(--amberbg)" : "var(--greenbg)", c: g.kind === "hit" ? "var(--red)" : g.kind === "skipped" ? "var(--amber)" : "var(--green)" })),
    noImgGroups: imgGroups.length === 0,
    fit,
  };
}
