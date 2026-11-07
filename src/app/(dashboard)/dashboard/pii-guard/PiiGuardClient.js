"use client";

import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import RangeBar from "../spend/RangeBar";
import { buildView, place, PAGE } from "./view";
import "../spend/spend.css";

const DAY = 864e5, IST = 5.5 * 3600e3;
const PRESET_DAYS = { "7D": 7, "30D": 30, "60D": 60, All: 90 };
// Range in ms for the API; the event log keeps at most 90 days.
function bounds(r, now = Date.now()) {
  if (r.preset === "Today") return { from: Math.floor((now + IST) / DAY) * DAY - IST, to: now };
  if (r.preset === "Custom") {
    const to = Math.min(now, Date.parse(r.to + "T00:00:00Z") - IST + DAY);
    return { from: Math.max(Date.parse(r.from + "T00:00:00Z") - IST, to - 90 * DAY), to };
  }
  return { from: now - (PRESET_DAYS[r.preset] || 1) * DAY + (r.preset === "All" ? 6e4 : 0), to: now };
}
async function call(url, body, signal) {
  const res = await fetch(url, { cache: "no-store", signal, ...(body && { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
const hhmmss = (ts) => new Date(Date.parse(ts) + IST).toISOString().slice(11, 19);
const toB64 = (file) => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = bad; r.readAsDataURL(file); });

export default function PiiGuardClient() {
  const router = useRouter();
  const [range, setRange] = useState({ preset: "24h" });
  const [data, setData] = useState(null);
  const [mode, setMode] = useState("loading");
  const [errorText, setErrorText] = useState("");
  const [rawEvents, setRawEvents] = useState([]);
  // Event log shows one fixed page. `evPage`: cursors of the pages above the current one (empty = newest page).
  const [evPage, setEvPage] = useState([]);
  const [evNext, setEvNext] = useState(null);
  const [evBusy, setEvBusy] = useState(false);
  const [samples, setSamples] = useState([]);
  const [toastState, setToast] = useState(null);
  const [test, setTest] = useState({ result: null, image: null, error: "", busy: false });
  const [ui, setUi] = useState({ tab: "overview", view: "value", openGroup: null, allLoc: false, q: "", fGroup: "", fAction: "", fClient: "", fModel: "", fSource: "", tests: false, sel: {}, page: 0, leakPage: 0, detail: null, pending: null, menu: null, showAllowed: false,
    testKind: "text", testText: "My mobile number is 9876543210 and PAN is ABCPE1234F.", testMode: "current", testWhere: "user", imgSel: 0, upload: null });
  const set = useCallback((p) => setUi((u) => ({ ...u, ...(typeof p === "function" ? p(u) : p) })), []);
  const [theme, setTheme] = useState("light");
  useEffect(() => {
    const el = document.documentElement, sync = () => setTheme(el.classList.contains("dark") ? "dark" : "light");
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  const fileRef = useRef(null), loadCtl = useRef(null);
  // A new load aborts the one in flight, so a slow old range never overwrites a newer one.
  const load = useCallback(async () => {
    loadCtl.current?.abort();
    const ctl = (loadCtl.current = new AbortController());
    const { from, to } = bounds(range);
    try {
      const d = await call(`/api/pii-guard?from=${Math.round(from)}&to=${Math.round(to)}`, null, ctl.signal);
      setData(d); setMode("ready");
    } catch (e) {
      if (ctl.signal.aborted) return;
      setErrorText(e.message || "Request failed"); setMode("error");
    }
  }, [range]);
  // Poll every 30 s while the tab is visible. The next poll starts after the last one ends; a hidden tab
  // stops polling and reloads when it is shown again.
  useEffect(() => {
    let t, gen = 0, off = false; // `gen`: only the newest tick schedules the next one, so chains never double up
    const tick = async () => { clearTimeout(t); const g = ++gen; if (document.visibilityState !== "visible") return; await load(); if (!off && g === gen) t = setTimeout(tick, 30e3); };
    const onVis = () => { if (document.visibilityState === "visible") tick(); else clearTimeout(t); };
    tick();
    document.addEventListener("visibilitychange", onVis);
    return () => { off = true; clearTimeout(t); loadCtl.current?.abort(); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  // Event log: 50 events per page, newest first, flattened to one row per hit. The server applies the
  // client, model, source and action filters. The 30 s refresh reloads only the newest page.
  const dq0 = useDeferredValue(ui.q);
  const evFilter = `&client=${encodeURIComponent(ui.fClient)}&model=${encodeURIComponent(ui.fModel)}&source=${ui.fSource}&action=${ui.fAction}&group=${encodeURIComponent(ui.fGroup)}&q=${encodeURIComponent(dq0)}${ui.tests ? "&tests=1" : ""}`;
  const fetchEvents = useCallback(async (cursor, signal) => {
    const { from, to } = bounds(range);
    const cur = cursor ? `&before=${cursor.before}&skip=${cursor.skip}` : "";
    const { events = [], next = null } = await call(`/api/pii-guard?events=1&limit=50&from=${Math.round(from)}&to=${Math.round(to)}${cur}${evFilter}`, null, signal);
    const rows = [];
    for (const e of events) (e.hits || []).forEach((h, i) => rows.push({ id: `${e.ts}:${e.requestId || ""}:${h.hash}:${h.rule}:${i}`, ts: e.ts, t: hhmmss(e.ts), rule: h.rule, name: h.name, hash: String(h.hash).slice(0, 6), fullHash: h.hash, preview: h.preview || "", context: h.context || "",
      loc: e.type === "ocr" ? `${place(String(h.source || "").replace(/\/ocr$/, ""))} · image #${(e.imageIndex ?? 0) + 1}` : place(h.source), a: h.action === "ignored" ? "allowed" : h.action || "observe", model: e.model || "—", client: e.client || "—",
      test: e.type === "test" || e.test === true, requestId: e.requestId || "", image: e.type === "ocr" ? e.sha256Prefix || null : null, imageIndex: e.imageIndex, req: e.requestId ? `${e.requestId.slice(0, 6)}…${e.requestId.slice(-2)}` : "—" }));
    return { rows, next };
  }, [range, evFilter]);
  // Range or filter change: back to the newest page.
  useEffect(() => { setEvPage([]); }, [range, evFilter]);
  const evCursor = evPage.at(-1)?.cursor || null, evNewest = evPage.length === 0;
  // The newest page follows `data` (the poll); older pages load once.
  const evTick = evNewest ? data : null;
  useEffect(() => {
    if (ui.tab !== "findings" || ui.view !== "hit") return;
    const ctl = new AbortController();
    setEvBusy(true);
    fetchEvents(evCursor, ctl.signal).then(({ rows, next }) => { setRawEvents(rows); setEvNext(next); setEvBusy(false); }).catch(() => { if (!ctl.signal.aborted) setEvBusy(false); });
    return () => ctl.abort();
  }, [ui.tab, ui.view, evTick, evCursor, fetchEvents]);
  const loadOlder = evNext && !evBusy ? () => setEvPage((p) => [...p, { cursor: evNext }]) : null;
  const loadNewer = !evNewest && !evBusy ? () => setEvPage((p) => p.slice(0, -1)) : null;
  const loadNewest = !evNewest && !evBusy ? () => setEvPage([]) : null;

  useEffect(() => { call("/api/pii-guard?samples=1").then((s) => setSamples(Array.isArray(s) ? s : [])).catch(() => {}); }, []);

  // Text test runs as the user types.
  const testId = useRef(0);
  useEffect(() => {
    if (ui.tab !== "test" || ui.testKind !== "text") return;
    const id = ++testId.current; // ignore responses from older inputs
    const t = setTimeout(() => {
      call("/api/pii-guard", { test: ui.testText, testMode: ui.testMode === "current" ? undefined : ui.testMode, testWhere: ui.testWhere })
        .then((r) => { if (id === testId.current) setTest((x) => ({ ...x, result: r, error: "" })); }).catch((e) => { if (id === testId.current) setTest((x) => ({ ...x, error: e.message })); });
    }, 300);
    return () => clearTimeout(t);
  }, [ui.tab, ui.testKind, ui.testText, ui.testMode, ui.testWhere]);
  // Image test: a sample, or the uploaded file.
  const ocrOn = !!data?.health?.ocr?.available && data?.config?.ocr?.mode !== "off";
  useEffect(() => {
    if (ui.tab !== "test" || ui.testKind !== "image" || !ocrOn) return;
    let off = false;
    const sample = samples[ui.imgSel];
    if (!ui.upload && !sample) return;
    const t = setTimeout(async () => {
      setTest((x) => ({ ...x, busy: true, image: null, error: "" }));
      try {
        const testImage = ui.upload ? { data: await toB64(ui.upload.file) } : { sample: sample.id };
        const r = await call("/api/pii-guard", { testImage });
        if (!off) setTest((x) => ({ ...x, image: r, busy: false }));
      } catch (e) { if (!off) setTest((x) => ({ ...x, error: e.message, busy: false })); }
    }, 0);
    return () => { off = true; clearTimeout(t); };
  }, [ui.tab, ui.testKind, ui.imgSel, ui.upload, samples, ocrOn]);

  // Saves a settings change, then reloads the current range. `undo` is the body that reverts it.
  // `loadRef` reloads the range current when the save ends, not the one when it started.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  const act = useCallback(async (body, toast, undo) => {
    try {
      await call("/api/pii-guard", body);
      setToast(toast ? { text: toast, undo } : null);
      loadRef.current();
    } catch (e) { alert(e.message); }
  }, []);

  const fit = null;
  // Typing in the search box updates the input at once; the filtered list follows at lower priority.
  const dq = useDeferredValue(ui.q);
  const vui = useMemo(() => (dq === ui.q ? ui : { ...ui, q: dq }), [ui, dq]);
  const v = useMemo(() => data && buildView({ data, ui: vui, set, act, range, fit, test, events: rawEvents, samples }), [data, vui, set, act, range, fit, test, rawEvents, samples]);

  const isLoading = mode === "loading" || (!v && mode !== "error"), isError = mode === "error";
  const preset = range.preset, customLabel = range.label || "";
  const onRange = (r) => { setRange(r); set({ sel: {}, detail: null, pending: null, page: 0, leakPage: 0 }); };
  const todayKey = new Date(Date.now() + IST).toISOString().slice(0, 10);
  const retry = () => { setMode("loading"); load(); };
  const openConsole = () => router.push("/dashboard/console-log");
  const toast = toastState?.text, undo = () => { const u = toastState?.undo; setToast(null); if (u) act(u); };
  const setFile = (file, name) => { if (file && file.type.startsWith("image/") && file.size <= 10 * 1024 * 1024) set({ upload: { file, name: name || file.name, url: URL.createObjectURL(file) } }); };
  const onFile = (e) => setFile(e.target.files?.[0]);
  const onDragOver = (e) => e.preventDefault();
  const onDrop = (e) => { e.preventDefault(); setFile(e.dataTransfer.files?.[0]); };
  const onPaste = (e) => setFile([...(e.clipboardData.files || [])].find((x) => x.type.startsWith("image/")), "pasted image");
  const vRef = useRef(null), gRef = useRef(null), fRef = useRef(null);
  const [fade, setFade] = useState({ v: false, g: false });
  const checkFade = useCallback(() => {
    const f = (el) => !!el && el.scrollWidth - el.clientWidth - el.scrollLeft > 2;
    const next = { v: f(vRef.current), g: f(gRef.current) };
    setFade((p) => (p.v === next.v && p.g === next.g ? p : next));
  }, []);
  // Re-observe only when the tab or sub-tab changes, the only times the two scrollers mount or unmount.
  useEffect(() => {
    checkFade();
    const ro = new ResizeObserver(checkFade);
    [vRef.current, gRef.current].forEach((el) => el && ro.observe(el));
    return () => ro.disconnect();
  }, [ui.tab, ui.view, mode, checkFade]);
  // Free the previous upload preview when it is replaced or the page closes.
  const uploadUrl = ui.upload?.url;
  useEffect(() => () => { if (uploadUrl) URL.revokeObjectURL(uploadUrl); }, [uploadUrl]);
  const mask = (on) => (on ? "linear-gradient(to right,#000 calc(100% - 40px),transparent)" : "none");
  const maskV = mask(fade.v), maskG = mask(fade.g), maskF = "none", fWrap = "wrap", fOverflow = "visible";
  const S = v?.s || {};
  const s = { header: true, leaks: S.leaks, numbers: S.numbers, bygroup: S.bygroup, where: S.where, wording: S.wording, mode: S.mode, groups: S.groups, values: S.values, test: S.test, health: S.health, ocr: S.ocr && v?.okScanner };
  const empty = {};
  const { rangeShort = "", status = { text: "Loading…", c: "var(--tx2)", bg: "var(--seg)" }, tabs = [], goLeaks, goHealth, leaks = [], noLeaks, leakCount, leakBorder, leakIcon, n = empty, cards = [], sumNote, byGroup = [], trendTitle, fbars = [], fgap, locs = [], toggleLoc, locBtn, byClient = [],
    redactRules, globalBtns = [], piiEx, ocrRows = [], groups = [], viewBtns = [], isValues, isEvents, shownLabel, groupOpts = [], clientOpts = [], modelOpts = [], hasSel, selCount, allSel, toggleAll,
    bulkAllow, values = [], noValues, hits = [], noHits, allowedCount = 0, showAllowed, toggleAllowed, allowed = [], detail, prevValues, nextValues, prevLeaks, nextLeaks, leakPageLabel, samples: sampleBtns = [], kindBtns = [], isText, isImage, testSegs = [], imgSegs = [], testHits = [], noTestHits,
    noHitsText, testVerdict = empty, testOut, thumbs = [], hasUpload, hasSample, imgBg, imgName, sampleName, sampleBg, problems = [], metrics = [], ocrStats = [], healthNote, ocrNote, imgGroups = [], health = empty } = v || {};
  // A filter change clears the selection, so bulk actions never hit hidden rows.
  const filt = (k) => (e) => set({ [k]: e.target.value, sel: {}, page: 0 });
  const q = ui.q, onQ = filt("q"), fGroup = ui.fGroup, onGroup = filt("fGroup"), fAction = ui.fAction, onAction = filt("fAction");
  const fClient = ui.fClient, onClient = filt("fClient"), onTests = (e) => set({ tests: e.target.checked, sel: {}, page: 0 });
  const fModel = ui.fModel, onModel = filt("fModel"), fSource = ui.fSource, onSource = filt("fSource");
  const clearSel = () => set({ sel: {} });
  const closeMenu = useCallback(() => set({ menu: null }), [set]);
  const moreBtn = { alignSelf: "center", marginTop: "10px", height: "28px", padding: "0 12px", borderRadius: "7px", border: "1px solid var(--line2)", background: "var(--card)", color: "var(--tx)", font: "inherit", fontSize: "12px", cursor: "pointer" };
  const testText = ui.testText, onTest = (e) => set({ testText: e.target.value }), testMode = ui.testMode, onTestMode = (e) => set({ testMode: e.target.value });
  const testWhere = ui.testWhere, onTestWhere = (e) => set({ testWhere: e.target.value });

  return (
    <div data-r9={theme} style={{ display: "flex", flexDirection: "column", minHeight: "100%", backgroundColor: "var(--bg)", backgroundImage: "linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px)", backgroundSize: "44px 44px", color: "var(--tx)", fontFamily: "system-ui,-apple-system,'Segoe UI',sans-serif", fontSize: "13px", lineHeight: "1.4" }}>
  <div style={{ display: "flex", alignItems: "stretch", flex: "1" }}>
  <main style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", position: "relative" }}>
    {(s.header) && (<>
      <div style={{ padding: "16px 32px 12px", display: "flex" }}><button onClick={goLeaks} style={{ display: "flex", alignItems: "center", gap: "8px", height: "28px", padding: "0 12px", borderRadius: "14px", border: "0", background: status.bg, color: status.c, font: "inherit", fontSize: "12.5px", fontWeight: "600", cursor: "pointer" }}><span style={{ width: "8px", height: "8px", borderRadius: "50%", background: status.c }}></span>{status.text}</button></div>
      <div style={{ position: "sticky", top: "0", zIndex: "30", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap", padding: "8px 32px", background: "var(--bg)", borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", gap: "2px", flexWrap: "wrap" }}>
          {(tabs).map((t, _i) => (<Fragment key={_i}>
            <button onClick={t.on} style={t.style}>{t.label}{(t.count) && (<><span style={{ fontSize: "11px", fontWeight: "600", padding: "0 6px", borderRadius: "9px", background: "var(--seg)", color: "var(--tx2)" }}>{t.count}</span></>)}{(t.dot) && (<><span style={{ width: "7px", height: "7px", borderRadius: "50%", background: t.dot }}></span></>)}</button>
          </Fragment>))}
        </div>
        <RangeBar preset={preset} customLabel={customLabel} onChange={onRange} today={todayKey} />
      </div>
    </>)}

    <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "16px 32px 48px" }}>
      {(isLoading) && (<>
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }}><div style={{ width: "120px", height: "12px", borderRadius: "6px", background: "var(--seg)" }}></div><div style={{ height: "40px", borderRadius: "8px", background: "var(--seg)" }}></div><div style={{ height: "40px", borderRadius: "8px", background: "var(--seg)" }}></div></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: "16px" }}><div style={{ height: "200px", borderRadius: "12px", background: "var(--card)", border: "1px solid var(--line)" }}></div><div style={{ height: "200px", borderRadius: "12px", background: "var(--card)", border: "1px solid var(--line)" }}></div></div>
        <div style={{ color: "var(--tx3)", fontSize: "12px", display: "flex", alignItems: "center", gap: "6px" }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "16px" }}>hourglass_top</span>Reading the PII Guard event log…</div>
      </>)}
      {(isError) && (<>
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", padding: "56px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", textAlign: "center" }}>
          <span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "36px", color: "var(--red)" }}>error</span>
          <div style={{ fontSize: "16px", fontWeight: "600" }}>Could not load PII Guard</div>
          <div style={{ color: "var(--tx2)", maxWidth: "480px", textWrap: "pretty" }}>{errorText} Requests still pass through (fail open).</div>
          <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}><button style={{ height: "32px", padding: "0 14px", borderRadius: "8px", border: "0", background: "var(--acc)", color: "#fff", font: "inherit", fontWeight: "600", cursor: "pointer" }} onClick={retry}>Retry</button><button style={{ height: "32px", padding: "0 14px", borderRadius: "8px", border: "1px solid var(--line2)", background: "var(--card)", color: "var(--tx)", font: "inherit", cursor: "pointer" }} onClick={openConsole}>Open Console Log</button></div>
        </div>
      </>)}

      {(s.leaks) && (<>
        <div style={{ background: "var(--card)", border: `1px solid ${leakBorder}`, borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "8px" }}><div style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "19px", color: status.c }}>{leakIcon}</span><span style={{ fontWeight: "600", fontSize: "14px" }}>Leaks</span><span style={{ color: "var(--tx3)", fontSize: "12px" }}>Matched a Redact or Block rule but could not be rewritten</span></div><span style={{ fontSize: "12px", color: "var(--tx3)" }}>{leakCount}</span></div>
          {(leaks).map((l) => (<Fragment key={l.key}>
            <div style={{ borderTop: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: "6px", padding: "10px 0" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: "8px 16px", alignItems: "center" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}><span style={{ display: "flex", gap: "8px", alignItems: "baseline", minWidth: "0" }}><span style={{ fontWeight: "600" }}>{l.rule}</span>{l.preview && <span style={{ fontFamily: "var(--mono)", fontSize: "12px", color: "var(--tx2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.preview}</span>}</span><span style={{ fontSize: "11.5px", color: "var(--tx3)" }}>{l.group} · <span style={{ fontFamily: "var(--mono)" }}>#{l.hash}</span> · {l.time}</span></div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-start" }}><span title={l.why} style={badgeSt("var(--redbg)", "var(--red)")}>{l.tag}</span><span style={{ fontSize: "12px", color: "var(--tx2)" }}>{l.loc}</span></div>
                <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap", gridColumn: "span 2" }}>
                  <button onClick={l.view} style={btn}>View</button>
                  <button onClick={l.allow} style={btn}>Allow</button>
                  <span style={{ fontSize: "11.5px", color: "var(--tx3)" }}>Rule action</span>
                  <div style={segWrap}>{l.ruleBtns.map((b) => <button key={b.label} onClick={b.on} style={b.style}>{b.label}</button>)}</div>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "2px 6px", fontSize: "11.5px", color: "var(--tx3)" }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "14px" }}>person</span><span>{l.client}</span><span>·</span><span style={{ fontFamily: "var(--mono)" }}>{l.model}</span></div>
              {(l.signed) && <div style={{ fontSize: "11.5px", color: "var(--tx2)", display: "flex", gap: "6px", alignItems: "flex-start" }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "15px", color: "var(--amber)" }}>info</span>Signed thinking can’t be rewritten. Redact drops it from older turns; Block stops the turn with a /rewind hint.</div>}
              {(l.pending) && <Confirm p={l.pending} />}
            </div>
          </Fragment>))}
          {(prevLeaks || nextLeaks) && (<div style={{ display: "flex", gap: "8px", justifyContent: "center", alignItems: "center", paddingTop: "8px", fontSize: "12px", color: "var(--tx3)" }}>
            <button onClick={prevLeaks || undefined} disabled={!prevLeaks} style={moreBtn}>Previous</button>
            <span>{leakPageLabel}</span>
            <button onClick={nextLeaks || undefined} disabled={!nextLeaks} style={moreBtn}>Next</button>
          </div>)}
          {(noLeaks) && (<>
            <div style={{ borderTop: "1px solid var(--line)", padding: "26px 0 18px", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", textAlign: "center" }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "30px", color: "var(--green)" }}>verified</span><span style={{ fontWeight: "600" }}>No leaks in this range</span><span style={{ color: "var(--tx3)", fontSize: "12px" }}>Every value with a Redact or Block rule was handled before sending.</span></div>
          </>)}
          {(toast) && (<><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "6px", padding: "8px 12px", borderRadius: "8px", background: "var(--tx)", color: "var(--bg)", fontSize: "12px" }}><span>{toast}</span><button onClick={undo} style={{ border: "0", background: "transparent", color: "var(--acc)", font: "inherit", fontWeight: "600", cursor: "pointer" }}>Undo</button></div></>)}
        </div>
      </>)}

      {(s.numbers) && (<>
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", gap: "28px", flexWrap: "wrap", alignItems: "stretch" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: "min(100%,300px)", flex: "0 1 340px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "8px" }}>
              {cards.map((c) => (<button key={c.label} onClick={c.on} title={c.title} style={{ textAlign: "left", border: "0", borderRadius: "8px", background: "var(--seg)", padding: "8px 10px", font: "inherit", color: "var(--tx)", cursor: "pointer", display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}>
                <span style={{ fontSize: "11px", color: "var(--tx2)", fontWeight: "600", letterSpacing: ".04em", textTransform: "uppercase" }}>{c.label}</span>
                <span style={{ fontSize: "20px", fontWeight: "650", color: c.c, fontVariantNumeric: "tabular-nums" }}>{c.value}</span>
                <span style={{ fontSize: "11px", color: "var(--tx3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.sub}</span>
              </button>))}
            </div>
            <span style={{ fontSize: "11px", color: "var(--tx3)", fontVariantNumeric: "tabular-nums" }}>Counts are unique values. Found = Redacted + Observed + Blocked + Leaked + Allowed ({sumNote}). Second line: requests (distinct turns). Hover a card for hits.</span>
          </div>
          <div style={{ flex: "1", minWidth: "280px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "11.5px", fontWeight: "600", letterSpacing: ".05em", color: "var(--tx2)" }}>{trendTitle}</span>
              <div style={{ display: "flex", gap: "14px", alignItems: "center", fontSize: "11.5px", color: "var(--tx2)" }}><span style={{ display: "flex", gap: "5px", alignItems: "center" }}><span style={{ width: "9px", height: "9px", borderRadius: "2px", background: "var(--acc)", opacity: ".75" }}></span>Findings</span><span style={{ display: "flex", gap: "5px", alignItems: "center" }}><span style={{ width: "9px", height: "9px", borderRadius: "50%", background: "var(--red)" }}></span>Leak</span>
                <button onClick={goHealth} style={{ display: "flex", alignItems: "center", gap: "6px", height: "24px", padding: "0 10px", borderRadius: "12px", border: "0", background: health.bg, color: health.c, font: "inherit", fontSize: "11.5px", fontWeight: "600", cursor: "pointer" }}><span style={{ width: "7px", height: "7px", borderRadius: "50%", background: health.c }}></span>{health.text}</button></div>
            </div>
            <div style={{ position: "relative", height: "150px", display: "flex", alignItems: "flex-end", gap: fgap, borderBottom: "1px solid var(--line2)", paddingTop: "14px" }}>
              {(fbars).map((b, _i) => (<Fragment key={_i}>
                <div style={{ flex: "1", minWidth: "0", height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", position: "relative" }}>
                  {(b.leak) && (<><span style={{ position: "absolute", top: "-12px", width: "9px", height: "9px", borderRadius: "50%", background: "var(--red)", border: "2px solid var(--card)" }}></span></>)}
                  <div title={b.title} style={{ width: "100%", height: b.h, background: "var(--acc)", opacity: b.op, borderRadius: "2px 2px 0 0" }}></div>
                </div>
              </Fragment>))}
            </div>
            <div style={{ display: "flex", gap: fgap }}>{(fbars).map((b, _i) => (<Fragment key={_i}><span style={{ flex: "1", minWidth: "0", fontSize: "10.5px", color: "var(--tx3)", whiteSpace: "nowrap" }}>{b.tick}</span></Fragment>))}</div>
          </div>
        </div>
      </>)}

      {(s.bygroup && byGroup.length > 0) && (<>
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "8px", minWidth: "0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontWeight: "600", fontSize: "14px" }}>By rule group</span><span style={{ fontSize: "11.5px", color: "var(--tx3)" }}>Unique values · click a count to open Findings</span></div>
          <div style={{ overflowX: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(140px,1.2fr) minmax(120px,1fr) repeat(4,72px) 64px", gap: "8px 12px", alignItems: "center", minWidth: "640px", fontSize: "12.5px" }}>
              {["Group", "Split", "Redacted", "Observed", "Blocked", "Leaked", "Total"].map((h, i) => <span key={i} style={{ fontSize: "11px", fontWeight: "600", color: "var(--tx3)", letterSpacing: ".04em", textAlign: i > 1 ? "right" : "left", textTransform: "uppercase" }}>{h}</span>)}
              {byGroup.map((g) => (<Fragment key={g.id}>
                <span>{g.name}</span>
                <Bar parts={g.bar} />
                {g.cells.map((c, i) => c.on ? <button key={i} onClick={c.on} style={{ border: "0", background: "transparent", padding: "0", font: "inherit", color: c.c, textAlign: "right", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: "2px", fontVariantNumeric: "tabular-nums" }}>{c.n}</button> : <span key={i} style={{ textAlign: "right", color: c.c, fontVariantNumeric: "tabular-nums" }}>{c.n}</span>)}
                <span style={{ textAlign: "right", fontWeight: "600", fontVariantNumeric: "tabular-nums" }}>{g.total}</span>
              </Fragment>))}
            </div>
          </div>
        </div>
      </>)}

      {(s.where) && (<>
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontSize: "11.5px", fontWeight: "600", letterSpacing: ".05em", color: "var(--tx2)" }}>WHERE VALUES APPEARED</span><button onClick={toggleLoc} style={{ border: "0", background: "transparent", color: "var(--acc)", font: "inherit", fontSize: "12px", cursor: "pointer" }}>{locBtn}</button></div>
          {(locs).map((w, _i) => (<Fragment key={_i}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(160px,220px) 1fr 90px", gap: "14px", alignItems: "center" }}>
              <span style={{ fontSize: "12.5px" }}>{w.name}</span>
              <div style={{ height: "8px", borderRadius: "4px", background: "var(--seg)", overflow: "hidden" }}><div style={{ height: "100%", width: w.w, background: "var(--acc)", borderRadius: "4px" }}></div></div>
              <span style={{ textAlign: "right", fontSize: "12px", color: "var(--tx2)", fontVariantNumeric: "tabular-nums" }}>{w.hits} hits</span>
            </div>
          </Fragment>))}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", borderTop: "1px solid var(--line)", paddingTop: "12px", marginTop: "4px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(100px,150px) 1fr 80px 64px", gap: "14px", fontSize: "11px", fontWeight: "600", letterSpacing: ".05em", color: "var(--tx3)" }}><span>BY CLIENT</span><span></span><span style={{ textAlign: "right" }}>VALUES</span><span style={{ textAlign: "right" }}>LEAKS</span></div>
            {(byClient).map((c, _i) => (<Fragment key={_i}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(100px,150px) 1fr 80px 64px", gap: "14px", alignItems: "center", fontSize: "12.5px" }}>
                <span style={{ display: "flex", flexDirection: "column", minWidth: "0" }}><span>{c.name}</span><span style={{ fontSize: "11px", color: "var(--tx3)" }}>{c.sub}</span></span>
                <div style={{ height: "6px", borderRadius: "3px", background: "var(--seg)", overflow: "hidden" }}><div style={{ height: "100%", width: c.w, background: "var(--tx3)", borderRadius: "3px", opacity: ".6" }}></div></div>
                <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.values}</span>
                <span style={{ textAlign: "right", fontWeight: "600", fontVariantNumeric: "tabular-nums", color: c.lc }}>{c.leaks}</span>
              </div>
            </Fragment>))}
          </div>
        </div>
      </>)}

      {(s.wording) && (<>
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}><span style={{ fontWeight: "600", fontSize: "14px" }}>Default action</span><span style={{ fontSize: "12px", color: "var(--tx2)" }}>Used by every rule group set to Default. {redactRules} rules override it with Redact.</span></div>
            <div style={{ display: "flex", gap: "2px", padding: "3px", borderRadius: "9px", background: "var(--seg)" }}>{(globalBtns).map((g, _i) => (<Fragment key={_i}><button onClick={g.on} style={g.style}>{g.label}</button></Fragment>))}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: "8px" }}>
            <div style={{ padding: "10px 12px", borderRadius: "8px", background: "var(--seg)", display: "flex", flexDirection: "column", gap: "3px" }}><span style={{ fontWeight: "600", fontSize: "12px" }}>Off</span><span style={{ fontSize: "11.5px", color: "var(--tx2)" }}>Not scanned.</span></div>
            <div style={{ padding: "10px 12px", borderRadius: "8px", background: "var(--bluebg)", display: "flex", flexDirection: "column", gap: "3px" }}><span style={{ fontWeight: "600", fontSize: "12px", color: "var(--blue)" }}>Observe</span><span style={{ fontSize: "11.5px", color: "var(--tx2)" }}>Logged. Request is sent unchanged.</span></div>
            <div style={{ padding: "10px 12px", borderRadius: "8px", background: "var(--acc2)", display: "flex", flexDirection: "column", gap: "3px" }}><span style={{ fontWeight: "600", fontSize: "12px", color: "var(--acc)" }}>Redact</span><span style={{ fontSize: "11.5px", color: "var(--tx2)" }}>Value replaced with <span style={{ fontFamily: "var(--mono)" }}>{piiEx}</span></span></div>
            <div style={{ padding: "10px 12px", borderRadius: "8px", background: "var(--redbg)", display: "flex", flexDirection: "column", gap: "3px" }}><span style={{ fontWeight: "600", fontSize: "12px", color: "var(--red)" }}>Block</span><span style={{ fontSize: "11.5px", color: "var(--tx2)" }}>Request rejected with HTTP 400.</span></div>
          </div>
        </div>
      </>)}

      {(s.mode) && (<>
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", paddingBottom: "8px" }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "19px", color: "var(--tx2)" }}>image_search</span><span style={{ fontWeight: "600", fontSize: "14px" }}>Images (OCR)</span><span style={{ fontSize: "12px", color: "var(--tx3)" }}>Text in images can only be observed, never redacted</span></div>
          {(ocrRows).map((o, _i) => (<Fragment key={_i}>
            <div style={{ display: "grid", gridTemplateColumns: "140px auto 1fr", gap: "16px", alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--line)" }}>
              <span style={{ fontWeight: "600", fontSize: "12.5px" }}>{o.label}</span>
              <div style={{ justifySelf: "start" }}>{(o.hasBtns) && (<><div style={{ display: "flex", gap: "2px", padding: "3px", borderRadius: "9px", background: "var(--seg)" }}>{(o.btns).map((g, _i) => (<Fragment key={_i}><button onClick={g.on} style={g.style}>{g.label}</button></Fragment>))}</div></>)}{(o.ro) && (<><span style={{ display: "inline-flex", alignItems: "center", gap: "5px", height: "28px", padding: "0 10px", borderRadius: "8px", border: "1px dashed var(--line2)", color: "var(--tx2)", fontSize: "12px" }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "15px" }}>lock</span>{o.ro}</span></>)}</div>
              <span style={{ fontSize: "12px", color: "var(--tx2)" }}>{o.desc}</span>
            </div>
          </Fragment>))}
        </div>
      </>)}

      {(s.groups) && (<>
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "4px", minWidth: "0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "8px" }}><span style={{ fontWeight: "600", fontSize: "14px" }}>Rule groups</span><span style={{ fontSize: "12px", color: "var(--tx3)" }}>Unique values in {rangeShort}, by action</span></div>
          <div ref={gRef} onScroll={checkFade} style={{ overflowX: "auto", WebkitMaskImage: maskG, maskImage: maskG }}>{(groups).map((g, _i) => (<Fragment key={_i}>
            <div style={{ borderTop: "1px solid var(--line)", minWidth: "700px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "24px minmax(150px,1fr) 170px 150px auto", gap: "12px", alignItems: "center", padding: "10px 0" }}>
                <button onClick={g.toggle} style={{ border: "0", background: "transparent", color: "var(--tx2)", cursor: "pointer", fontFamily: "'Material Symbols Outlined'", fontSize: "18px", padding: "0" }}>{g.chev}</button>
                <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}><span style={{ fontWeight: "600" }}>{g.name}</span><span style={{ fontSize: "11.5px", color: "var(--tx3)" }}>{g.ruleCount} {g.ruleCount === 1 ? "rule" : "rules"}</span></div>
                <span style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "12px", color: "var(--tx2)", fontVariantNumeric: "tabular-nums" }}><Bar parts={g.bar} /><span style={{ minWidth: "32px", textAlign: "right" }}>{g.total}</span></span>
                <span>{(g.differs) && (<><span style={{ fontSize: "10.5px", fontWeight: "600", padding: "2px 7px", borderRadius: "5px", background: "var(--amberbg)", color: "var(--amber)" }}>{g.badge}</span></>)}</span>
                <div style={{ display: "flex", gap: "2px", padding: "3px", borderRadius: "9px", background: "var(--seg)" }}>{(g.btns).map((b, _i) => (<Fragment key={_i}><button onClick={b.on} style={b.style}>{b.label}</button></Fragment>))}</div>
              </div>
              {(g.open) && (<>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: "6px", padding: "0 0 12px 36px" }}>
                  {(g.rules).map((r, _i) => (<Fragment key={_i}><div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "7px 10px", borderRadius: "7px", background: "var(--seg)", fontSize: "12px" }}><span style={{ display: "flex", justifyContent: "space-between" }}><span>{r.name}</span><span style={{ color: "var(--tx3)", fontVariantNumeric: "tabular-nums" }}>{r.total}</span></span><Bar parts={r.bar} /></div></Fragment>))}
                </div>
              </>)}
            </div>
          </Fragment>))}</div>
        </div>
      </>)}

      {(s.values) && (<>
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px", display: "flex", flexDirection: "column", gap: "8px", minWidth: "0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <div style={segWrap}>{viewBtns.map((g) => <button key={g.label} onClick={g.on} style={g.style}>{g.label}</button>)}</div>
            <span style={{ display: "flex", gap: "16px", alignItems: "center", fontSize: "12px", color: "var(--tx3)" }}>
              <button onClick={toggleAllowed} style={{ border: "0", background: "transparent", padding: "0", font: "inherit", color: "var(--acc)", cursor: "pointer" }}>Allowed values ({allowedCount})</button>
              <span>{shownLabel}</span>
            </span>
          </div>
          {(showAllowed) && (<div style={{ padding: "8px 16px", borderRadius: "8px", background: "var(--seg)", display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px" }}>
            <span style={{ color: "var(--tx2)", padding: "4px 0" }}>Allowed values are sent unchanged in every request and every rule. Restore one to scan it again.</span>
            {allowed.map((x) => <div key={x.hash} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", borderTop: "1px solid var(--line)", padding: "4px 0" }}><span style={{ minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.name} <span style={{ fontFamily: "var(--mono)", color: "var(--tx3)" }}>{x.preview}</span></span><button onClick={x.restore} style={btn}>Restore</button></div>)}
            {allowed.length === 0 && <span style={{ color: "var(--tx3)", padding: "4px 0" }}>No values are allowed.</span>}
          </div>)}
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px", minWidth: "0", display: "flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 8px", border: "1px solid var(--line2)", borderRadius: "8px", background: "var(--card)" }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "17px", color: "var(--tx3)" }}>search</span><input value={q} onChange={onQ} placeholder="Rule, masked value, model, client or hash" style={{ border: "0", outline: "none", background: "transparent", color: "var(--tx)", font: "inherit", flex: "1", minWidth: "0" }} /></div>
            <select value={fGroup} onChange={onGroup} style={selSt}><option value="">All groups</option>{groupOpts.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
            <select value={fAction} onChange={onAction} style={selSt}><option value="">All actions</option><option value="redact">Redacted</option><option value="observe">Observed</option><option value="block">Blocked</option><option value="leaked">Leaked</option><option value="allowed">Allowed</option></select>
            <select value={fSource} onChange={onSource} style={selSt}><option value="">All sources</option><option value="text">Text</option><option value="ocr">OCR</option></select>
            <select value={fClient} onChange={onClient} style={selSt}><option value="">All clients</option>{clientOpts.map((o) => <option key={o}>{o}</option>)}</select>
            <select value={fModel} onChange={onModel} style={selSt}><option value="">All models</option>{modelOpts.map((o) => <option key={o}>{o}</option>)}</select>
            {(isEvents) && <label style={{ display: "flex", gap: "6px", alignItems: "center", fontSize: "12px", color: "var(--tx2)", whiteSpace: "nowrap" }}><input type="checkbox" checked={ui.tests} onChange={onTests} />Include tests</label>}
          </div>
          {(hasSel) && (<div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "8px", borderRadius: "8px", background: "var(--tx)", color: "var(--bg)" }}>
            <span style={{ fontWeight: "600", fontSize: "12.5px", padding: "0 8px" }}>{selCount} selected</span>
            <button onClick={bulkAllow} style={darkBtn}>Allow</button>
            <button onClick={clearSel} style={{ ...darkBtn, marginLeft: "auto", background: "transparent" }}>Clear</button>
          </div>)}
          <div ref={vRef} onScroll={checkFade} style={{ overflowX: "auto", WebkitMaskImage: maskV, maskImage: maskV }}>{(isValues) && (<>
            <div style={{ ...rowGrid(VCOLS), fontSize: "11px", fontWeight: "600", color: "var(--tx3)", letterSpacing: ".04em", padding: "4px 0" }}><input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Select all" /><span>VALUE</span><span>BECAME</span><span>ACTION</span><span style={{ textAlign: "right" }}>REQUESTS</span><span>LAST SEEN</span><span>CLIENT</span><span></span></div>
            {(values).map((v) => (<Fragment key={v.key}>
              <div style={{ ...rowGrid(VCOLS), padding: "8px 0", borderTop: "1px solid var(--line)", background: v.bg, position: "relative" }}>
                <input type="checkbox" checked={v.sel} onChange={v.toggle} aria-label={`Select ${v.name}`} />
                <button onClick={v.view} style={{ border: "0", background: "transparent", padding: "0", font: "inherit", color: "var(--tx)", textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: "12px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.preview}</span>
                  <span style={{ fontSize: "11px", color: "var(--tx3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.name} · {v.group}{v.ocr ? " · OCR" : ""}</span>
                </button>
                <span title={v.became} style={{ fontFamily: "var(--mono)", fontSize: "11px", color: "var(--tx2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.became}</span>
                <span style={badgeSt(v.abg, v.ac)}>{v.action}</span>
                <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: "12px" }}>{v.reqs}</span>
                <span style={{ fontSize: "12px", color: "var(--tx2)", whiteSpace: "nowrap" }}>{v.last}</span>
                <span style={{ fontSize: "12px", color: "var(--tx2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.client}</span>
                <button onClick={v.openMenu} aria-label="Row actions" aria-expanded={v.menu} style={{ ...btn, padding: "0", width: "28px", fontFamily: "'Material Symbols Outlined'", fontSize: "18px" }}>more_horiz</button>
                {(v.menu) && <RowMenu v={v} close={closeMenu} />}
              </div>
              {(v.pending) && <div style={{ padding: "0 0 8px 32px" }}><Confirm p={v.pending} /></div>}
            </Fragment>))}
            {(noValues) && (<><div style={{ padding: "32px 0", textAlign: "center", color: "var(--tx3)" }}>No values match these filters.</div></>)}
            {(prevValues || nextValues) && (<div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
              <button onClick={prevValues || undefined} disabled={!prevValues} style={moreBtn}>Previous {PAGE}</button>
              <button onClick={nextValues || undefined} disabled={!nextValues} style={moreBtn}>Next {PAGE}</button>
            </div>)}
          </>)}
          {(isEvents) && (<>
            <div style={{ ...rowGrid(HCOLS), fontSize: "11px", fontWeight: "600", color: "var(--tx3)", letterSpacing: ".04em", padding: "4px 0" }}><input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Select all" /><span>TIME</span><span>VALUE</span><span>ACTION</span><span>WHERE</span><span>CLIENT</span><span>MODEL</span><span>REQUEST</span><span></span></div>
            {(hits).map((e) => (<Fragment key={e.id}>
              <div style={{ ...rowGrid(HCOLS), padding: "8px 0", borderTop: "1px solid var(--line)", fontSize: "12px", background: e.bg }}>
                <input type="checkbox" checked={e.sel} onChange={e.toggle} aria-label={`Select ${e.rule}`} />
                <span style={{ color: "var(--tx2)", fontVariantNumeric: "tabular-nums" }}>{e.t}</span>
                <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}><span style={{ fontFamily: "var(--mono)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.preview || `#${e.hash}`}</span><span style={{ fontSize: "11px", color: "var(--tx3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.rule}{e.test ? " · test" : ""}</span></span>
                <span style={badgeSt(e.abg, e.ac)}>{e.action}</span>
                <span style={{ color: "var(--tx2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.loc}</span>
                <span style={{ color: "var(--tx2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.client}</span>
                <span title={e.model} style={{ fontFamily: "var(--mono)", fontSize: "11.5px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.model}</span>
                <span title={e.requestId} style={{ fontFamily: "var(--mono)", fontSize: "11.5px", color: "var(--tx3)" }}>{e.req}</span>
                <button onClick={e.view} style={btn}>View</button>
              </div>
            </Fragment>))}
            {(noHits && !evBusy) && (<div style={{ padding: "32px 0", textAlign: "center", color: "var(--tx3)" }}>No hits match these filters.</div>)}
            <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
              {(loadNewest) && (<button onClick={loadNewest} style={moreBtn}>Newest</button>)}
              {(loadNewer) && (<button onClick={loadNewer} style={moreBtn}>Newer 50</button>)}
              {(loadOlder) && (<button onClick={loadOlder} style={moreBtn}>Older 50</button>)}
            </div>
          </>)}</div>
        </div>
      </>)}

      {(s.test) && (<>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,400px),1fr))", gap: "16px", alignItems: "stretch" }}>
          <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontWeight: "600", fontSize: "14px" }}>Input</span><div style={{ display: "flex", gap: "2px", padding: "3px", borderRadius: "9px", background: "var(--seg)" }}>{(kindBtns).map((g, _i) => (<Fragment key={_i}><button onClick={g.on} style={g.style}>{g.label}</button></Fragment>))}</div></div>
            {(isText) && (<>
            <textarea value={testText} onChange={onTest} style={{ minHeight: "180px", resize: "vertical", border: "1px solid var(--line2)", borderRadius: "9px", padding: "12px", background: "var(--bg)", color: "var(--tx)", fontFamily: "var(--mono)", fontSize: "12.5px", lineHeight: "1.6", outline: "0" }}></textarea>
            <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}><span style={{ fontSize: "12px", color: "var(--tx3)" }}>Try an example</span>{(sampleBtns).map((x, _i) => (<Fragment key={_i}><button onClick={x.on} style={{ height: "26px", padding: "0 10px", borderRadius: "13px", border: "1px solid var(--line2)", background: "var(--card)", color: "var(--tx)", font: "inherit", fontSize: "11.5px", cursor: "pointer" }}>{x.label}</button></Fragment>))}</div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "11.5px", color: "var(--tx2)" }}>Test with<select value={testMode} onChange={onTestMode} style={{ height: "32px", flex: "none", border: "1px solid var(--line2)", borderRadius: "8px", background: "var(--card)", color: "var(--tx)", font: "inherit", padding: "0 8px", minWidth: "170px" }}><option value="current">Current rules</option><option value="redact">Everything on Redact</option></select></label>
              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "11.5px", color: "var(--tx2)" }}>Where<select value={testWhere} onChange={onTestWhere} style={{ height: "32px", flex: "none", border: "1px solid var(--line2)", borderRadius: "8px", background: "var(--card)", color: "var(--tx)", font: "inherit", padding: "0 8px", minWidth: "170px" }}><option value="user">User · text</option><option value="tool_result">User · tool result</option><option value="assistant">Assistant · text</option><option value="system">System</option><option value="thinking">Signed thinking</option></select></label>
            </div>
            </>)}
            {(isImage) && (<>
              <div tabIndex={0} onPaste={onPaste} onDrop={onDrop} onDragOver={onDragOver} style={{ minHeight: "190px", border: "1.5px dashed var(--line2)", borderRadius: "9px", background: "var(--bg)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", padding: "12px", outline: "0", boxSizing: "border-box" }}>
                {(hasUpload) && (<><div style={{ width: "100%", height: "140px", borderRadius: "6px", background: imgBg }}></div><span style={{ fontSize: "11.5px", color: "var(--tx3)" }}>{imgName}</span></>)}
                {(hasSample) && (<><div style={{ width: "100%", height: "120px", borderRadius: "6px", background: sampleBg }} title={sampleName}></div><div style={{ fontFamily: "var(--mono)", fontSize: "11.5px", color: "var(--tx2)" }}>sample: {sampleName}</div></>)}
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", justifyContent: "center", fontSize: "12px", color: "var(--tx2)" }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "18px" }}>add_photo_alternate</span>Drop or paste (⌘V) an image here, or<button type="button" onClick={() => fileRef.current?.click()} style={{ border: "0", padding: "0", background: "transparent", color: "var(--acc)", font: "inherit", fontWeight: "600", cursor: "pointer" }}>choose a file</button><input ref={fileRef} type="file" accept="image/*" onChange={onFile} hidden /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: "6px" }}>{(thumbs).map((t, _i) => (<Fragment key={_i}><button onClick={t.on} title={t.name} style={t.style}>{t.short}</button></Fragment>))}</div>
              <div style={{ fontSize: "11.5px", color: "var(--tx3)", display: "flex", gap: "6px", alignItems: "center" }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "15px" }}>visibility</span>Images are observe only. Findings are logged; the image is sent unchanged.</div>
            </>)}
          </div>
          <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontWeight: "600", fontSize: "14px" }}>Result</span><span style={{ fontSize: "11.5px", fontWeight: "600", padding: "2px 8px", borderRadius: "5px", background: testVerdict.bg, color: testVerdict.c }}>{testVerdict.text}</span></div>
            {(isText) && (<><div style={{ padding: "12px", borderRadius: "9px", border: "1px solid var(--line)", fontFamily: "var(--mono)", fontSize: "12.5px", lineHeight: "1.75", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{(testSegs).map((x, _i) => (<Fragment key={_i}><span style={x.st}>{x.t}</span></Fragment>))}</div></>)}
            {(isImage) && (<><div style={{ display: "flex", flexDirection: "column", gap: "6px" }}><span style={{ fontSize: "11.5px", fontWeight: "600", letterSpacing: ".05em", color: "var(--tx2)" }}>OCR TEXT</span><div style={{ padding: "12px", borderRadius: "9px", border: "1px solid var(--line)", fontFamily: "var(--mono)", fontSize: "12.5px", lineHeight: "1.75", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{(imgSegs).map((x, _i) => (<Fragment key={_i}><span style={x.st}>{x.t}</span></Fragment>))}</div></div></>)}
            <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
              {(testHits).map((h, _i) => (<Fragment key={_i}><div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "10px", alignItems: "center", padding: "7px 0", borderTop: "1px solid var(--line)", fontSize: "12px" }}><span><b>{h.rule}</b> <span style={{ color: "var(--tx3)" }}>· {h.group}</span></span><span style={{ fontFamily: "var(--mono)", color: "var(--tx3)", fontSize: "11px" }}>#{h.hash}</span><span style={{ fontSize: "11px", fontWeight: "600", padding: "2px 7px", borderRadius: "5px", background: h.abg, color: h.ac }}>{h.action}</span></div></Fragment>))}
              {(noTestHits) && (<><div style={{ padding: "10px 0", color: "var(--tx3)", fontSize: "12px", borderTop: "1px solid var(--line)" }}>{noHitsText}</div></>)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}><span style={{ fontSize: "11.5px", fontWeight: "600", letterSpacing: ".05em", color: "var(--tx2)" }}>WHAT THE MODEL RECEIVES</span><div style={{ padding: "12px", borderRadius: "9px", background: "var(--seg)", fontFamily: "var(--mono)", fontSize: "12.5px", lineHeight: "1.7", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{testOut}</div></div>
          </div>
        </div>
      </>)}

      {(s.health) && (<>
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "19px", color: "var(--amber)" }}>warning</span><span style={{ fontWeight: "600", fontSize: "14px" }}>Problems</span></div><span style={{ fontSize: "12px", color: "var(--tx3)" }}>{healthNote}</span></div>
          {(problems).map((p, _i) => (<Fragment key={_i}>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "12px", alignItems: "center", padding: "10px 12px", borderRadius: "9px", background: p.bg }}>
              <span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "18px", color: p.c }}>{p.icon}</span>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}><span style={{ fontWeight: "600" }}>{p.title}</span><span style={{ fontSize: "12px", color: "var(--tx2)" }}>{p.desc}</span></div>
              <span>{(p.cta) && (<><button onClick={p.onCta} style={{ height: "28px", padding: "0 10px", borderRadius: "7px", border: "1px solid var(--line2)", background: "var(--card)", color: "var(--tx)", font: "inherit", fontSize: "12px", cursor: "pointer", whiteSpace: "nowrap" }}>{p.cta}</button></>)}</span>
            </div>
          </Fragment>))}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: "8px" }}>
            {(metrics).map((m, _i) => (<Fragment key={_i}>
              <div style={{ background: "var(--seg)", borderRadius: "8px", padding: "9px 12px", display: "flex", flexDirection: "column", gap: "1px" }}><span style={{ fontSize: "11px", color: "var(--tx3)" }}>{m.label}</span><span style={{ fontWeight: "600", fontVariantNumeric: "tabular-nums", color: m.c }}>{m.value}</span><span style={{ fontSize: "11px", color: "var(--tx3)" }}>{m.sub}</span></div>
            </Fragment>))}
          </div>
        </div>
      </>)}

      {(s.ocr) && (<>
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "19px", color: "var(--tx2)" }}>image_search</span><span style={{ fontWeight: "600", fontSize: "14px" }}>Images (OCR)</span></div><span style={{ fontSize: "12px", color: "var(--tx3)" }}>{ocrNote}</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: "8px" }}>
            {(ocrStats).map((m, _i) => (<Fragment key={_i}>
              <div style={{ background: "var(--seg)", borderRadius: "8px", padding: "9px 12px", display: "flex", flexDirection: "column", gap: "1px" }}><span style={{ fontSize: "11px", color: "var(--tx3)" }}>{m.label}</span><span style={{ fontWeight: "600", fontVariantNumeric: "tabular-nums" }}>{m.value}</span><span style={{ fontSize: "11px", color: "var(--tx3)" }}>{m.sub}</span></div>
            </Fragment>))}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: "11.5px", fontWeight: "600", letterSpacing: ".05em", color: "var(--tx2)", paddingBottom: "6px" }}>RECENT IMAGES · GROUPED</span>
            {(imgGroups).map((g, _i) => (<Fragment key={_i}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 72px minmax(0,1.4fr)", gap: "12px", alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--line)", fontSize: "12px" }}>
                <span style={{ display: "flex", flexDirection: "column", gap: "1px", minWidth: "0" }}><span style={{ fontFamily: "var(--mono)", overflowWrap: "anywhere" }}>{g.model}</span><span style={{ color: "var(--tx3)", fontSize: "11px" }}>{g.when}</span></span>
                <span style={{ fontWeight: "600" }}>{g.count}</span>
                <span style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", minWidth: "0" }}><span style={{ fontSize: "10.5px", fontWeight: "600", padding: "1px 6px", borderRadius: "4px", background: g.bg, color: g.c }}>{g.status}</span><span style={{ color: "var(--tx2)" }}>{g.detail}</span></span>
              </div>
            </Fragment>))}
          </div>
        </div>
      </>)}
    </div>
  </main>
  </div>
      {(detail) && <Drawer d={detail} />}
    </div>
  );
}

// Shared bits. Inline styles match the rest of the page (design: PII Guard.dc.html, round 17).
const btn = { height: "28px", padding: "0 10px", borderRadius: "7px", border: "1px solid var(--line2)", background: "var(--card)", color: "var(--tx)", font: "inherit", fontSize: "12px", cursor: "pointer", whiteSpace: "nowrap" };
const darkBtn = { height: "26px", padding: "0 10px", borderRadius: "6px", border: "0", background: "rgba(127,127,127,.25)", color: "inherit", font: "inherit", fontSize: "12px", cursor: "pointer" };
const segWrap = { display: "flex", gap: "2px", padding: "3px", borderRadius: "9px", background: "var(--seg)" };
// Native select with its own chevron 8px after the text, so a long model name never pushes it far right.
const CHEV = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23888' stroke-width='1.5'/%3E%3C/svg%3E\")";
const selSt = { height: "32px", flex: "none", maxWidth: "180px", textOverflow: "ellipsis", appearance: "none", WebkitAppearance: "none", border: "1px solid var(--line2)", borderRadius: "8px", backgroundColor: "var(--card)", backgroundImage: CHEV, backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center", color: "var(--tx)", font: "inherit", fontSize: "12.5px", padding: "0 26px 0 8px", cursor: "pointer" };
const badgeSt = (bg, c) => ({ justifySelf: "start", display: "inline-flex", alignItems: "center", height: "20px", fontSize: "11px", fontWeight: "600", padding: "0 8px", borderRadius: "5px", background: bg, color: c, whiteSpace: "nowrap" });
const VCOLS = "24px minmax(180px,1.6fr) minmax(140px,1.1fr) 88px 72px 80px minmax(96px,.8fr) 32px";
const HCOLS = "24px 64px minmax(150px,1.3fr) 88px minmax(140px,1.1fr) minmax(96px,.8fr) minmax(110px,.9fr) 80px 56px";
const rowGrid = (cols) => ({ display: "grid", gridTemplateColumns: cols, gap: "8px", alignItems: "center", minWidth: "880px" });

function Bar({ parts }) {
  return <div style={{ display: "flex", height: "8px", borderRadius: "4px", background: "var(--seg)", overflow: "hidden", flex: "1", minWidth: "80px" }}>{parts.map((p, i) => <div key={i} title={p.title} style={{ width: p.w, background: p.color }} />)}</div>;
}

function Confirm({ p }) {
  return (
    <div role="alertdialog" style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", padding: "8px 12px", borderRadius: "8px", background: "var(--amberbg)", fontSize: "12px", color: "var(--tx)" }}>
      <span style={{ flex: "1 1 240px" }}>{p.text}</span>
      <button onClick={p.cancel} style={btn}>Cancel</button>
      <button onClick={p.ok} style={{ ...btn, border: "0", background: "var(--acc)", color: "#fff", fontWeight: "600" }}>Change rule</button>
    </div>
  );
}

function RowMenu({ v, close }) {
  const ref = useRef(null);
  // Light dismiss, same as the range calendar.
  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target)) close(); };
    const key = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [close]);
  const item = { border: "0", background: "transparent", textAlign: "left", padding: "6px 10px", borderRadius: "6px", font: "inherit", fontSize: "12.5px", color: "var(--tx)", cursor: "pointer" };
  return (
    <div ref={ref} role="menu" style={{ position: "absolute", right: "0", top: "100%", zIndex: 40, width: "220px", background: "var(--card)", border: "1px solid var(--line2)", borderRadius: "10px", boxShadow: "0 12px 32px rgba(40,20,10,.16)", padding: "4px", display: "flex", flexDirection: "column" }}>
      <button role="menuitem" style={item} onClick={() => { close(); v.view(); }}>View details</button>
      <button role="menuitem" style={item} onClick={() => { close(); v.allow(); }}>{v.allowLabel}</button>
      <span style={{ padding: "6px 10px 2px", fontSize: "11px", color: "var(--tx3)" }}>Set rule action (all values)</span>
      <div style={{ ...segWrap, margin: "2px 6px 6px" }}>{v.ruleBtns.map((b) => <button key={b.label} role="menuitem" onClick={() => { close(); b.on(); }} style={b.style}>{b.label}</button>)}</div>
    </div>
  );
}

function Sec({ label, children }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}><span style={{ fontSize: "11px", fontWeight: "600", letterSpacing: ".05em", color: "var(--tx3)", textTransform: "uppercase" }}>{label}</span>{children}</div>;
}
// Marks the masked value inside its masked context.
function highlight(text, mark) {
  const at = mark ? text.indexOf(mark) : -1;
  if (at < 0) return text;
  return <>{text.slice(0, at)}<span style={{ background: "var(--bluebg)", color: "var(--blue)", borderRadius: "4px", padding: "0 4px" }}>{mark}</span>{text.slice(at + mark.length)}</>;
}

function Drawer({ d }) {
  // Broken image = expired; keyed by URL so a new image starts unbroken.
  const [brokenSrc, setBrokenSrc] = useState(null);
  const broken = brokenSrc === d.image;
  useEffect(() => {
    const key = (e) => { if (e.key === "Escape") d.close(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [d]);
  const row = (label, value, mono) => value ? <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}><span style={{ fontSize: "11px", color: "var(--tx3)" }}>{label}</span><span style={{ fontSize: "12.5px", fontFamily: mono ? "var(--mono)" : "inherit", overflowWrap: "anywhere" }}>{value}</span></div> : null;
  return (
    <>
      <div onClick={d.close} style={{ position: "fixed", inset: "0", background: "rgba(0,0,0,.25)", zIndex: 80 }} />
      <aside role="dialog" aria-modal="true" aria-label={`${d.title} details`} style={{ position: "fixed", top: "0", right: "0", bottom: "0", width: "min(420px,100vw)", zIndex: 81, background: "var(--card)", borderLeft: "1px solid var(--line2)", boxShadow: "-12px 0 32px rgba(0,0,0,.12)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", padding: "16px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: "0" }}><span style={{ fontFamily: "var(--mono)", fontSize: "16px", fontWeight: "600", overflowWrap: "anywhere" }}>{d.preview}</span><span style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "12px", color: "var(--tx3)" }}><span style={{ ...badgeSt("var(--card)", "var(--tx2)"), border: "1px solid var(--line2)" }}>{d.rule}</span>{d.group}</span></div>
          <button onClick={d.close} aria-label="Close" style={{ ...btn, padding: "0", width: "28px", fontFamily: "'Material Symbols Outlined'", fontSize: "18px" }}>close</button>
        </div>
        <div style={{ flex: "1", overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <Sec label="Became"><span style={{ fontFamily: d.action === "Redacted" ? "var(--mono)" : "inherit", fontSize: "12.5px" }}>{d.became}</span></Sec>
          <Sec label="Action"><span style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}><span style={badgeSt(d.abg, d.ac)}>{d.action}</span><span style={{ fontSize: "12px", color: "var(--tx2)" }}>{d.why}</span></span></Sec>
          <Sec label="Where in the request"><span style={{ fontSize: "12.5px" }}>{d.where}</span>
            {d.noContext ? <span style={{ fontSize: "12px", color: "var(--tx3)" }}>{d.image ? "Found in an image; see below." : "No context recorded. Context is stored for findings logged from this release on."}</span>
              : <><span style={{ fontFamily: "var(--mono)", fontSize: "12px", padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--line2)", overflowWrap: "anywhere" }}>{highlight(d.context, d.preview)}</span><span style={{ fontSize: "11px", color: "var(--tx3)" }}>Masked preview and about 20 characters of masked context. Raw values are never stored.</span></>}</Sec>
          {(d.image) && (<Sec label={`Image · ${d.imageLabel}`}>
            {broken ? <span style={{ fontSize: "12px", color: "var(--tx3)", padding: "16px", borderRadius: "6px", background: "var(--seg)", textAlign: "center" }}>Image expired (kept 14 days)</span>
              : <a href={d.image} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- auth-checked API image */}
                <img src={d.image} alt={d.imageLabel} onError={() => setBrokenSrc(d.image)} style={{ width: "100%", maxHeight: "320px", objectFit: "contain", borderRadius: "6px", background: "var(--seg)" }} /></a>}</Sec>)}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            {row("Client", d.client)}{row("Model", d.model, true)}{row("Requests", d.reqs)}{row("First seen", d.first)}{row("Last seen", d.last)}{row("Hash", `#${d.hash}`, true)}{row("Request", d.request, true)}
          </div>
          {(d.pending) && <Confirm p={d.pending} />}
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", padding: "16px", borderTop: "1px solid var(--line)" }}>
          <button onClick={d.allow} style={btn}>{d.allowLabel}</button>
          <span style={{ marginLeft: "auto", fontSize: "11.5px", color: "var(--tx3)" }}>Set rule action</span>
          <div style={segWrap}>{d.ruleBtns.map((b) => <button key={b.label} onClick={b.on} style={b.style}>{b.label}</button>)}</div>
        </div>
      </aside>
    </>
  );
}
