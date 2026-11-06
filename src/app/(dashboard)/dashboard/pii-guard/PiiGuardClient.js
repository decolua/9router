"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import RangeBar from "../spend/RangeBar";
import { buildView, place } from "./view";
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
async function call(url, body) {
  const res = await fetch(url, { cache: "no-store", ...(body && { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
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
  const [samples, setSamples] = useState([]);
  const [toastState, setToast] = useState(null);
  const [test, setTest] = useState({ result: null, image: null, error: "", busy: false });
  const [ui, setUi] = useState({ tab: "overview", sub: "values", openLeak: null, openGroup: null, allLoc: false, q: "", fGroup: "", fAction: "", fClient: "", fModel: "", fSource: "", fStatus: "active", sel: {},
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

  const loadId = useRef(0);
  const load = useCallback(async () => {
    const id = ++loadId.current; // ignore responses from superseded ranges
    const { from, to } = bounds(range);
    try {
      const d = await call(`/api/pii-guard?from=${Math.round(from)}&to=${Math.round(to)}`);
      if (id !== loadId.current) return;
      setData(d); setMode("ready");
    } catch (e) {
      if (id !== loadId.current) return;
      setErrorText(e.message || "Request failed"); setMode("error");
    }
  }, [range]);
  useEffect(() => { const t = setTimeout(load, 0); const iv = setInterval(load, 30e3); return () => { clearTimeout(t); clearInterval(iv); }; }, [load]);

  // Event log: latest 50 events in range, flattened to one row per hit.
  useEffect(() => {
    if (ui.tab !== "findings" || ui.sub !== "events") return;
    let off = false;
    const { from, to } = bounds(range);
    call(`/api/pii-guard?events=1&limit=50&from=${Math.round(from)}&to=${Math.round(to)}`).then(({ events = [] }) => {
      if (off) return;
      const rows = [];
      for (const e of events) for (const h of e.hits || []) rows.push({ t: hhmmss(e.ts), rule: h.rule, name: h.name, hash: String(h.hash).slice(0, 6), loc: place(h.source), a: h.action || "observe", model: e.model || "—", key: e.ua ? String(e.ua).split("/")[0] : "—", req: e.requestId ? `${e.requestId.slice(0, 6)}…${e.requestId.slice(-2)}` : "—" });
      setRawEvents(rows.slice(0, 100));
    }).catch(() => {});
    return () => { off = true; };
  }, [ui.tab, ui.sub, range, data]);

  useEffect(() => { call("/api/pii-guard?samples=1").then((s) => setSamples(Array.isArray(s) ? s : [])).catch(() => {}); }, []);

  // Text test runs as the user types.
  useEffect(() => {
    if (ui.tab !== "test" || ui.testKind !== "text") return;
    const t = setTimeout(() => {
      call("/api/pii-guard", { test: ui.testText, testMode: ui.testMode === "current" ? undefined : ui.testMode, testWhere: ui.testWhere })
        .then((r) => setTest((x) => ({ ...x, result: r, error: "" }))).catch((e) => setTest((x) => ({ ...x, error: e.message })));
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
  const act = useCallback(async (body, toast, undo) => {
    try {
      await call("/api/pii-guard", body);
      setToast(toast ? { text: toast, undo } : null);
      load();
    } catch (e) { alert(e.message); }
  }, [load]);

  const fit = null;
  const v = useMemo(() => data && buildView({ data, ui, set, act, range, fit, test, events: rawEvents, samples }), [data, ui, set, act, range, fit, test, rawEvents, samples]);

  const isLoading = mode === "loading" || (!v && mode !== "error"), isError = mode === "error";
  const preset = range.preset, customLabel = range.label || "";
  const onRange = (r) => { setRange(r); set({ sel: {}, openLeak: null }); };
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
  useEffect(() => {
    checkFade();
    const ro = new ResizeObserver(checkFade);
    [vRef, gRef].forEach((r) => r.current && ro.observe(r.current));
    return () => ro.disconnect();
  });
  const mask = (on) => (on ? "linear-gradient(to right,#000 calc(100% - 40px),transparent)" : "none");
  const maskV = mask(fade.v), maskG = mask(fade.g), maskF = "none", fWrap = "wrap", fOverflow = "visible";
  const S = v?.s || {};
  const s = { header: true, leaks: S.leaks, numbers: S.numbers, where: S.where, wording: S.wording, mode: S.mode, groups: S.groups, values: S.values, test: S.test, health: S.health, ocr: S.ocr && v?.okScanner };
  const empty = {};
  const { rangeShort = "", status = { text: "Loading…", c: "var(--tx2)", bg: "var(--seg)" }, tabs = [], goLeaks, goHealth, leaks = [], noLeaks, leakCount, leakBorder, leakIcon, n = empty, trendTitle, fbars = [], fgap, locs = [], toggleLoc, locBtn, byClient = [],
    redactRules, globalBtns = [], piiEx, ocrRows = [], groups = [], subTabs = [], isValues, isEvents, shownLabel, groupOpts = [], clientOpts = [], modelOpts = [], hasSel, selCount, allSel, toggleAll,
    bulkIgnore, bulkObserve, bulkRedact, bulkBlock, copyHashes, values = [], noValues, events = [], samples: sampleBtns = [], kindBtns = [], isText, isImage, testSegs = [], imgSegs = [], testHits = [], noTestHits,
    noHitsText, testVerdict = empty, testOut, thumbs = [], hasUpload, hasSample, imgBg, imgName, sampleName, sampleBg, problems = [], metrics = [], ocrStats = [], healthNote, ocrNote, imgGroups = [], health = empty } = v || {};
  const q = ui.q, onQ = (e) => set({ q: e.target.value });
  const fGroup = ui.fGroup, onGroup = (e) => set({ fGroup: e.target.value }), fAction = ui.fAction, onAction = (e) => set({ fAction: e.target.value });
  const fStatus = ui.fStatus, onStatus = (e) => set({ fStatus: e.target.value, sel: {} }), fClient = ui.fClient, onClient = (e) => set({ fClient: e.target.value });
  const fModel = ui.fModel, onModel = (e) => set({ fModel: e.target.value }), fSource = ui.fSource, onSource = (e) => set({ fSource: e.target.value });
  const clearSel = () => set({ sel: {} });
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
          {(leaks).map((l, _i) => (<Fragment key={_i}>
            <div style={{ borderTop: "1px solid var(--line)", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "8px 14px", alignItems: "center", padding: "10px 0 4px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}><span style={{ fontWeight: "600" }}>{l.rule}</span><span style={{ fontSize: "11.5px", color: "var(--tx3)" }}>{l.group} · <span style={{ fontFamily: "var(--mono)" }}>#{l.hash}</span></span></div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-start" }}><span style={{ fontSize: "10.5px", fontWeight: "600", padding: "1px 7px", borderRadius: "4px", background: "var(--redbg)", color: "var(--red)" }}>{l.tag}</span><span style={{ fontSize: "12px", color: "var(--tx2)" }}>{l.loc}</span></div>
                <span style={{ fontSize: "12px", color: "var(--tx2)" }}>{l.time}</span>
                {(l.isOpen) && (<><div style={{ display: "flex", gap: "6px", justifyContent: "flex-end", flexWrap: "wrap", gridColumn: "span 2" }}>
                  <button onClick={l.review} style={{ height: "28px", padding: "0 10px", borderRadius: "7px", border: "1px solid var(--line2)", background: "var(--card)", color: "var(--tx)", font: "inherit", fontSize: "12px", cursor: "pointer" }}>{l.reviewLabel}</button>
                  <button onClick={l.ignore} style={{ height: "28px", padding: "0 10px", borderRadius: "7px", border: "1px solid var(--line2)", background: "var(--card)", color: "var(--tx)", font: "inherit", fontSize: "12px", cursor: "pointer" }}>Ignore</button>
                  <button onClick={l.blockNext} style={{ height: "28px", padding: "0 10px", borderRadius: "7px", border: "0", background: "var(--acc)", color: "#fff", font: "inherit", fontSize: "12px", fontWeight: "600", cursor: "pointer", whiteSpace: "nowrap" }}>Block next time</button>
                </div></>)}
                {(l.isRuled) && (<><span style={{ justifySelf: "end", fontSize: "12px", color: "var(--green)", fontWeight: "600", display: "flex", gap: "4px", alignItems: "center" }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "16px" }}>block</span>Blocks next time</span></>)}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "2px 6px", padding: "0 0 10px", fontSize: "11.5px", color: "var(--tx3)", minWidth: "0" }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "14px" }}>person</span><span>{l.client}</span><span>·</span><span style={{ fontFamily: "var(--mono)" }}>{l.model}</span>{(l.hasSess) && (<><a href="Spend.dc.html" title="Opens Spend \u2192 Agents and sessions, filtered to this session" style={{ fontFamily: "var(--mono)", color: "var(--acc)", textDecoration: "underline", textUnderlineOffset: "2px" }}>{l.sess}</a></>)}{(l.noSess) && (<><span style={{ fontStyle: "italic" }}>session not recorded</span></>)}</div>
              {(l.expanded) && (<>
                <div style={{ margin: "0 0 12px", padding: "12px 14px", borderRadius: "8px", background: "var(--seg)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "10px 18px", fontSize: "12px" }}>
                  <div style={{ gridColumn: "1/-1", display: "flex", gap: "6px", color: "var(--tx)" }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "16px", color: "var(--red)" }}>info</span><span><b>Reason:</b> {l.why}</span></div>
                  <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: "var(--tx3)" }}>Location</span><span>{l.loc}</span></div>
                  <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: "var(--tx3)" }}>First seen</span><span>{l.first}</span></div>
                  <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: "var(--tx3)" }}>Last seen</span><span>{l.last}</span></div>
                  <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: "var(--tx3)" }}>Hits</span><span>{l.hits}</span></div>
                  <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: "var(--tx3)" }}>Hash</span><span style={{ fontFamily: "var(--mono)" }}>#{l.hash}</span></div>
                  <div style={{ gridColumn: "1/-1", color: "var(--tx2)" }}>Block next time: <b style={{ color: "var(--tx)" }}>{l.fix}</b></div>
                </div>
              </>)}
            </div>
          </Fragment>))}
          {(noLeaks) && (<>
            <div style={{ borderTop: "1px solid var(--line)", padding: "26px 0 18px", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", textAlign: "center" }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "30px", color: "var(--green)" }}>verified</span><span style={{ fontWeight: "600" }}>No leaks in this range</span><span style={{ color: "var(--tx3)", fontSize: "12px" }}>Every value with a Redact or Block rule was handled before sending.</span></div>
          </>)}
          {(toast) && (<><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "6px", padding: "8px 12px", borderRadius: "8px", background: "var(--tx)", color: "var(--bg)", fontSize: "12px" }}><span>{toast}</span><button onClick={undo} style={{ border: "0", background: "transparent", color: "var(--acc)", font: "inherit", fontWeight: "600", cursor: "pointer" }}>Undo</button></div></>)}
        </div>
      </>)}

      {(s.numbers) && (<>
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", gap: "28px", flexWrap: "wrap", alignItems: "stretch" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "14px", minWidth: "180px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}><span style={{ fontSize: "11.5px", color: "var(--tx2)", fontWeight: "600", letterSpacing: ".05em" }}>VALUES FOUND</span><span style={{ fontSize: "24px", fontWeight: "650", fontVariantNumeric: "tabular-nums" }}>{n.found}</span><span style={{ fontSize: "11.5px", color: "var(--tx3)" }}>{n.foundHits}</span></div>
            <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}><span style={{ fontSize: "11.5px", color: "var(--tx2)", fontWeight: "600", letterSpacing: ".05em" }}>REDACTED</span><span style={{ fontSize: "24px", fontWeight: "650", color: "var(--acc)", fontVariantNumeric: "tabular-nums" }}>{n.redacted}<span style={{ fontSize: "13px", fontWeight: "500", color: "var(--tx2)" }}> values</span></span><span style={{ fontSize: "11.5px", color: "var(--tx3)" }}>{n.redactedHits}</span></div>
            <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}><span style={{ fontSize: "11.5px", color: "var(--tx2)", fontWeight: "600", letterSpacing: ".05em" }}>BLOCKED</span><span style={{ fontSize: "24px", fontWeight: "650", fontVariantNumeric: "tabular-nums" }}>{n.blocked}<span style={{ fontSize: "13px", fontWeight: "500", color: "var(--tx2)" }}> values</span></span><span style={{ fontSize: "11.5px", color: "var(--tx3)" }}>{n.blockedHits}</span></div>
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "8px" }}><span style={{ fontWeight: "600", fontSize: "14px" }}>Rule groups</span><span style={{ fontSize: "12px", color: "var(--tx3)" }}>Hits in {rangeShort}</span></div>
          <div ref={gRef} onScroll={checkFade} style={{ overflowX: "auto", WebkitMaskImage: maskG, maskImage: maskG }}>{(groups).map((g, _i) => (<Fragment key={_i}>
            <div style={{ borderTop: "1px solid var(--line)", minWidth: "700px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "24px minmax(150px,1fr) 170px 150px auto", gap: "12px", alignItems: "center", padding: "10px 0" }}>
                <button onClick={g.toggle} style={{ border: "0", background: "transparent", color: "var(--tx2)", cursor: "pointer", fontFamily: "'Material Symbols Outlined'", fontSize: "18px", padding: "0" }}>{g.chev}</button>
                <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}><span style={{ fontWeight: "600" }}>{g.name}</span><span style={{ fontSize: "11.5px", color: "var(--tx3)" }}>{g.ruleCount} {g.ruleCount === 1 ? "rule" : "rules"}</span></div>
                <span style={{ fontSize: "12px", color: "var(--tx2)", fontVariantNumeric: "tabular-nums" }}>{g.hits} hits · {g.uniq} unique</span>
                <span>{(g.differs) && (<><span style={{ fontSize: "10.5px", fontWeight: "600", padding: "2px 7px", borderRadius: "5px", background: "var(--amberbg)", color: "var(--amber)" }}>{g.badge}</span></>)}</span>
                <div style={{ display: "flex", gap: "2px", padding: "3px", borderRadius: "9px", background: "var(--seg)" }}>{(g.btns).map((b, _i) => (<Fragment key={_i}><button onClick={b.on} style={b.style}>{b.label}</button></Fragment>))}</div>
              </div>
              {(g.open) && (<>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: "6px", padding: "0 0 12px 36px" }}>
                  {(g.rules).map((r, _i) => (<Fragment key={_i}><div style={{ display: "flex", justifyContent: "space-between", padding: "7px 10px", borderRadius: "7px", background: "var(--seg)", fontSize: "12px" }}><span>{r.name}</span><span style={{ color: "var(--tx3)", fontVariantNumeric: "tabular-nums" }}>{r.hits}</span></div></Fragment>))}
                </div>
              </>)}
            </div>
          </Fragment>))}</div>
        </div>
      </>)}

      {(s.values) && (<>
        <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "14px 18px", display: "flex", flexDirection: "column", gap: "10px", minWidth: "0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
            <div style={{ display: "flex", gap: "2px", padding: "3px", borderRadius: "9px", background: "var(--seg)" }}>{(subTabs).map((g, _i) => (<Fragment key={_i}><button onClick={g.on} style={g.style}>{g.label}</button></Fragment>))}</div>
            <span style={{ fontSize: "12px", color: "var(--tx3)" }}>{shownLabel}</span>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 100%", minWidth: "200px", display: "flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 10px", border: "1px solid var(--line2)", borderRadius: "8px", background: "var(--card)" }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "17px", color: "var(--tx3)" }}>search</span><input value={q} onChange={onQ} placeholder="Rule, name, or hash" style={{ flex: "1", border: "0", outline: "0", background: "transparent", color: "var(--tx)", font: "inherit" }} /></div>
            <div ref={fRef} onScroll={checkFade} style={{ flex: "1 1 100%", minWidth: "0", display: "flex", gap: "8px", scrollbarWidth: "none", flexWrap: fWrap, overflowX: fOverflow, WebkitMaskImage: maskF, maskImage: maskF }}>
            <select value={fGroup} onChange={onGroup} style={{ height: "32px", flex: "none", border: "1px solid var(--line2)", borderRadius: "8px", background: "var(--card)", color: "var(--tx)", font: "inherit", padding: "0 8px" }}><option value="">All groups</option>{groupOpts.map((o) => <option key={o}>{o}</option>)}</select>
            <select value={fAction} onChange={onAction} style={{ height: "32px", flex: "none", border: "1px solid var(--line2)", borderRadius: "8px", background: "var(--card)", color: "var(--tx)", font: "inherit", padding: "0 8px" }}><option value="">All actions</option><option value="observe">Observe</option><option value="redact">Redact</option><option value="block">Block</option><option value="leaked">Leaked</option></select>
            <select value={fStatus} onChange={onStatus} style={{ height: "32px", flex: "none", border: "1px solid var(--line2)", borderRadius: "8px", background: "var(--card)", color: "var(--tx)", font: "inherit", padding: "0 8px" }}><option value="active">Active</option><option value="leaked">Leaked</option><option value="ignored">Ignored</option></select>
            <select value={fClient} onChange={onClient} style={{ height: "32px", flex: "none", border: "1px solid var(--line2)", borderRadius: "8px", background: "var(--card)", color: "var(--tx)", font: "inherit", padding: "0 8px" }}><option value="">All clients</option>{clientOpts.map((o) => <option key={o}>{o}</option>)}</select>
            <select value={fModel} onChange={onModel} style={{ height: "32px", flex: "none", border: "1px solid var(--line2)", borderRadius: "8px", background: "var(--card)", color: "var(--tx)", font: "inherit", padding: "0 8px" }}><option value="">All models</option>{modelOpts.map((o) => <option key={o}>{o}</option>)}</select>
            <select value={fSource} onChange={onSource} style={{ height: "32px", flex: "none", border: "1px solid var(--line2)", borderRadius: "8px", background: "var(--card)", color: "var(--tx)", font: "inherit", padding: "0 8px" }}><option value="">All sources</option><option value="text">Text</option><option value="ocr">OCR</option></select></div>
          </div>
          {(hasSel) && (<>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "8px 10px", borderRadius: "9px", background: "var(--tx)", color: "var(--bg)" }}>
              <span style={{ fontWeight: "600", fontSize: "12.5px", paddingRight: "6px" }}>{selCount} selected</span>
              <button onClick={bulkIgnore} style={{ height: "26px", padding: "0 10px", borderRadius: "6px", border: "0", background: "rgba(127,127,127,.25)", color: "inherit", font: "inherit", fontSize: "12px", cursor: "pointer" }}>Ignore</button>
              <span style={{ fontSize: "12px", opacity: ".7", paddingLeft: "4px" }}>Set action</span>
              <button onClick={bulkObserve} style={{ height: "26px", padding: "0 10px", borderRadius: "6px", border: "0", background: "rgba(127,127,127,.25)", color: "inherit", font: "inherit", fontSize: "12px", cursor: "pointer" }}>Observe</button>
              <button onClick={bulkRedact} style={{ height: "26px", padding: "0 10px", borderRadius: "6px", border: "0", background: "rgba(127,127,127,.25)", color: "inherit", font: "inherit", fontSize: "12px", cursor: "pointer" }}>Redact</button>
              <button onClick={bulkBlock} style={{ height: "26px", padding: "0 10px", borderRadius: "6px", border: "0", background: "rgba(127,127,127,.25)", color: "inherit", font: "inherit", fontSize: "12px", cursor: "pointer" }}>Block</button>
              <button style={{ height: "26px", padding: "0 10px", borderRadius: "6px", border: "0", background: "rgba(127,127,127,.25)", color: "inherit", font: "inherit", fontSize: "12px", cursor: "pointer" }} onClick={copyHashes}>Copy hashes</button>
              <button onClick={clearSel} style={{ marginLeft: "auto", height: "26px", padding: "0 10px", borderRadius: "6px", border: "0", background: "transparent", color: "inherit", font: "inherit", fontSize: "12px", cursor: "pointer", opacity: ".8" }}>Clear</button>
            </div>
          </>)}
          <div ref={vRef} onScroll={checkFade} style={{ overflowX: "auto", WebkitMaskImage: maskV, maskImage: maskV }}>{(isValues) && (<>
            <div style={{ display: "grid", gridTemplateColumns: "24px minmax(160px,1.5fr) minmax(130px,1.2fr) 96px 124px 76px 88px 52px 64px", gap: "10px", fontSize: "11px", fontWeight: "600", color: "var(--tx3)", letterSpacing: ".04em", padding: "4px 0", minWidth: "890px", alignItems: "center" }}><input type="checkbox" checked={allSel} onChange={toggleAll} /><span>NAME</span><span>WHERE</span><span>CLIENT</span><span>MODEL · SESSION</span><span>ACTION</span><span>SEEN ↓</span><span style={{ textAlign: "right" }}>HITS</span><span></span></div>
            {(values).map((v, _i) => (<Fragment key={_i}>
              <div style={{ display: "grid", gridTemplateColumns: "24px minmax(160px,1.5fr) minmax(130px,1.2fr) 96px 124px 76px 88px 52px 64px", gap: "10px", alignItems: "center", padding: "7px 0", borderTop: "1px solid var(--line)", minWidth: "890px", background: v.bg }}>
                <input type="checkbox" checked={v.sel} onChange={v.toggle} />
                <div style={{ display: "flex", flexDirection: "column", gap: "1px", minWidth: "0" }}><span style={{ display: "flex", gap: "6px", alignItems: "center" }}><span style={{ fontWeight: "600" }}>{v.name}</span>{(v.leaked) && (<><span style={{ fontSize: "10px", fontWeight: "700", padding: "1px 5px", borderRadius: "4px", background: "var(--redbg)", color: "var(--red)" }}>LEAKED</span></>)}</span><span style={{ fontSize: "11px", color: "var(--tx3)" }}>{v.group} · <span style={{ fontFamily: "var(--mono)" }}>#{v.hash}</span></span></div>
                <span style={{ fontSize: "11.5px", color: "var(--tx2)" }}>{v.where}</span>
                <span style={{ fontSize: "12px", display: "flex", flexDirection: "column", minWidth: "0" }}><span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.client}</span></span>
                <span style={{ display: "flex", flexDirection: "column", minWidth: "0" }}><span title={v.model} style={{ fontFamily: "var(--mono)", fontSize: "11.5px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.model}</span><span title={v.sessTip} style={{ fontFamily: "var(--mono)", fontSize: "10.5px", color: "var(--tx3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.sess}</span></span>
                <span style={{ justifySelf: "start", fontSize: "11px", fontWeight: "600", padding: "2px 7px", borderRadius: "5px", background: v.abg, color: v.ac }}>{v.action}</span>
                <span style={{ display: "flex", flexDirection: "column", minWidth: "0", whiteSpace: "nowrap" }}><span style={{ fontSize: "12px" }}>{v.last}</span><span style={{ fontSize: "10.5px", color: "var(--tx3)" }}>first {v.first}</span></span>
                <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: "12px" }}>{v.hits}</span>
                <button onClick={v.ignore} style={{ height: "26px", padding: "0 8px", borderRadius: "6px", border: "1px solid var(--line2)", background: "var(--card)", color: "var(--tx)", font: "inherit", fontSize: "11.5px", cursor: "pointer" }}>{v.ignoreLabel}</button>
              </div>
            </Fragment>))}
            {(noValues) && (<><div style={{ padding: "28px 0", textAlign: "center", color: "var(--tx3)" }}>No values match these filters.</div></>)}
          </>)}
          {(isEvents) && (<>
            <div style={{ display: "grid", gridTemplateColumns: "80px minmax(160px,1.3fr) minmax(150px,1.2fr) 86px minmax(120px,1fr) minmax(130px,1fr) 90px", gap: "10px", fontSize: "11px", fontWeight: "600", color: "var(--tx3)", letterSpacing: ".04em", padding: "4px 0", minWidth: "860px" }}><span>TIME</span><span>RULE</span><span>WHERE</span><span>ACTION</span><span>MODEL</span><span>CLIENT</span><span>REQUEST</span></div>
            {(events).map((e, _i) => (<Fragment key={_i}>
              <div style={{ display: "grid", gridTemplateColumns: "80px minmax(160px,1.3fr) minmax(150px,1.2fr) 86px minmax(120px,1fr) minmax(130px,1fr) 90px", gap: "10px", alignItems: "center", padding: "7px 0", borderTop: "1px solid var(--line)", fontSize: "12px", minWidth: "860px" }}>
                <span style={{ color: "var(--tx2)", fontVariantNumeric: "tabular-nums" }}>{e.t}</span>
                <span>{e.rule} <span style={{ fontFamily: "var(--mono)", color: "var(--tx3)", fontSize: "11px" }}>#{e.hash}</span></span>
                <span style={{ color: "var(--tx2)" }}>{e.loc}</span>
                <span style={{ justifySelf: "start", fontSize: "11px", fontWeight: "600", padding: "2px 7px", borderRadius: "5px", background: e.abg, color: e.ac }}>{e.action}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: "11.5px" }}>{e.model}</span>
                <span style={{ color: "var(--tx2)" }}>{e.key}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: "11.5px", color: "var(--tx3)" }}>{e.req}</span>
              </div>
            </Fragment>))}
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
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", justifyContent: "center", fontSize: "12px", color: "var(--tx2)" }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "18px" }}>add_photo_alternate</span>Drop or paste (⌘V) an image here, or<label style={{ color: "var(--acc)", fontWeight: "600", cursor: "pointer" }}>choose a file<input type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} /></label></div>
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
    </div>
  );
}
