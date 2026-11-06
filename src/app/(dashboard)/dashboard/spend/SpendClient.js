"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import RangeBar from "./RangeBar";
import { buildView } from "./view";
import "./spend.css";

async function getJson(url, opts) {
  const res = await fetch(url, { cache: "no-store", ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

export default function SpendClient() {
  const router = useRouter();
  const [range, setRange] = useState({ preset: "30D" });
  const [data, setData] = useState(null);
  const [mode, setMode] = useState("loading");
  const [errorText, setErrorText] = useState("");
  const [quota, setQuota] = useState({});
  const [ui, setUi] = useState({ group: "key", agView: "sessions", agFilter: null, agOpen: null, rank: "value", hover: null, editing: false, draft: null });
  const set = useCallback((p) => setUi((u) => ({ ...u, ...(typeof p === "function" ? p(u) : p) })), []);
  const aPanel = useRef(null), aRef = useRef(null), rRef = useRef(null), oRef = useRef(null);
  const [feeRefs] = useState(() => ({})); // input elements by sub key, for focus
  const [fit, setFit] = useState({ fadeA: false, fadeR: false, oNarrow: false, aW: 1060 });
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
    setMode((m) => (m === "ready" ? "ready" : "loading"));
    const q = new URLSearchParams({ preset: range.preset });
    if (range.preset === "Custom") { q.set("from", range.from); q.set("to", range.to); }
    try {
      const d = await getJson(`/api/spend?${q}`);
      if (id !== loadId.current) return;
      setData(d);
      setMode(d.totals.req === 0 ? "empty" : "ready");
    } catch (e) {
      if (id !== loadId.current) return;
      setErrorText(e.message || "Request failed");
      setMode("error");
    }
  }, [range]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  // Allowance and provider balances come from the Quota Tracker endpoints.
  useEffect(() => {
    let off = false;
    getJson("/api/providers").then(async ({ connections = [] }) => {
      const want = ["claude", "codex", "antigravity", "opencode-go", "muse", "openrouter", "deepseek"];
      const list = connections.filter((c) => want.includes(c.provider) && c.isActive !== false);
      const out = {};
      await Promise.all(list.map(async (c) => {
        try { const u = await getJson(`/api/usage/${c.id}`); (out[c.provider] ||= []).push({ name: c.name, ...u }); } catch { /* quota is optional */ }
      }));
      if (!off) setQuota(out);
    }).catch(() => {});
    return () => { off = true; };
  }, []);

  const checkFade = useCallback(() => {
    const f = (el) => !!el && el.scrollWidth - el.clientWidth - el.scrollLeft > 2;
    const ow = oRef.current ? oRef.current.clientWidth : 9999;
    const next = { fadeA: f(aRef.current), fadeR: f(rRef.current), oNarrow: ow < 760, aW: aRef.current ? aRef.current.clientWidth : fit.aW };
    setFit((p) => (p.fadeA === next.fadeA && p.fadeR === next.fadeR && p.oNarrow === next.oNarrow && Math.abs(p.aW - next.aW) <= 2 ? p : next));
  }, [fit.aW]);
  useEffect(() => {
    checkFade();
    const ro = new ResizeObserver(checkFade);
    [aRef, rRef, oRef].forEach((r) => r.current && ro.observe(r.current));
    return () => ro.disconnect();
  });

  const saveFees = useCallback(async () => {
    const draft = ui.draft || {};
    try {
      const { fees } = await getJson("/api/spend", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fees: draft }) });
      setData((d) => ({ ...d, fees }));
      set({ editing: false, draft: null });
    } catch (e) { alert(e.message); }
  }, [ui.draft, set]);

  useEffect(() => {
    if (ui.scrollTick) aPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [ui.scrollTick]);
  const v = useMemo(() => data && buildView({ data, quota, ui, set, fit, range, theme, feeRefs, saveFees }), [data, quota, ui, set, fit, range, theme, saveFees, feeRefs]);

  const isLoading = mode === "loading" || !v, isEmpty = mode === "empty", isError = mode === "error";
  const preset = range.preset, customLabel = range.label || "";
  const onRange = (r) => { setRange(r); set({ hover: null, agFilter: null, agOpen: null }); };
  const todayKey = data ? new Date(data.now + 5.5 * 3600e3).toISOString().slice(0, 10) : null;
  const showLast30 = () => onRange({ preset: "30D" });
  const retry = () => load();
  const openConsole = () => router.push("/dashboard/console-log");
  const emptyText = `9Router logged no calls in this range (${data?.range?.first ?? ""} – ${data?.range?.last ?? ""} IST). Real spend is $0.00. Allowance and fees still apply.`;
  const ready = mode === "ready" && v;
  const s = { range: true, top: ready, real: ready, time: ready, allowance: (ready || isEmpty) && !!v, subvalue: (ready || isEmpty) && !!v, breakdown: ready, agents: ready, outliers: ready };
  const minH = "100%";
  const rangeTitle = v?.rangeTitle ?? "";
  const rangeSub = v?.rangeSub ?? "";
  const { k, or, ds, trend, chart, readout, allowance, subs, dayCount, editing, notEditing, startEdit, cancelEdit, saveEdit, groups, groupHead, rows, rankBtns, outliers, noOutliers, topDays, topDaysTitle, ag, aWpx, detCols, maskA, maskR, bdNote, outNote, loggedNote, nrTip, skel } = v || { skel: [] };

  return (
    <div data-r9={theme} style={{ display: "flex", flexDirection: "column", minHeight: minH, backgroundColor: "var(--bg)", backgroundImage: "linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px)", backgroundSize: "44px 44px", color: "var(--tx)", fontFamily: "system-ui,-apple-system,'Segoe UI',sans-serif", fontSize: "13px", lineHeight: "1.4" }}>
      <div style={{ display: "flex", alignItems: "stretch", flex: "1" }}>
      <main style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column" }}>
        {(s.range) && (<>
          <div style={{ position: "sticky", top: "0", zIndex: "30", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap", padding: "10px 32px", background: "var(--bg)", borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}><span style={{ fontWeight: "600" }}>{rangeTitle}</span><span style={{ color: "var(--tx3)", fontSize: "12px" }}>{rangeSub}</span></div>
            <RangeBar preset={preset} customLabel={customLabel} onChange={onRange} today={todayKey} />
          </div>
        </>)}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "16px 32px 48px" }}>

          {(isLoading) && (<>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: "16px" }}>
              <div style={{ height: "118px", borderRadius: "12px", background: "var(--card)", border: "1px solid var(--line)", padding: "18px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "12px" }}><div style={{ width: "40%", height: "10px", borderRadius: "5px", background: "var(--seg)" }}></div><div style={{ width: "55%", height: "24px", borderRadius: "6px", background: "var(--seg)" }}></div><div style={{ width: "75%", height: "10px", borderRadius: "5px", background: "var(--seg)" }}></div></div>
              <div style={{ height: "118px", borderRadius: "12px", background: "var(--card)", border: "1px solid var(--line)", padding: "18px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "12px" }}><div style={{ width: "40%", height: "10px", borderRadius: "5px", background: "var(--seg)" }}></div><div style={{ width: "55%", height: "24px", borderRadius: "6px", background: "var(--seg)" }}></div><div style={{ width: "75%", height: "10px", borderRadius: "5px", background: "var(--seg)" }}></div></div>
              <div style={{ height: "118px", borderRadius: "12px", background: "var(--card)", border: "1px solid var(--line)", padding: "18px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "12px" }}><div style={{ width: "40%", height: "10px", borderRadius: "5px", background: "var(--seg)" }}></div><div style={{ width: "55%", height: "24px", borderRadius: "6px", background: "var(--seg)" }}></div><div style={{ width: "75%", height: "10px", borderRadius: "5px", background: "var(--seg)" }}></div></div>
            </div>
            <div style={{ height: "300px", borderRadius: "12px", background: "var(--card)", border: "1px solid var(--line)", display: "flex", alignItems: "flex-end", gap: "6px", padding: "24px", boxSizing: "border-box" }}>{(skel).map((k, _i) => (<Fragment key={_i}><div style={{ flex: "1", borderRadius: "3px", background: "var(--seg)", height: k.h }}></div></Fragment>))}</div>
            <div style={{ color: "var(--tx3)", fontSize: "12px", display: "flex", alignItems: "center", gap: "6px" }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "16px" }}>hourglass_top</span>Reading request rows and quota data…</div>
          </>)}

          {(isEmpty) && (<>
            <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", padding: "64px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", textAlign: "center" }}>
              <span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "36px", color: "var(--tx3)" }}>receipt_long</span>
              <div style={{ fontSize: "16px", fontWeight: "600" }}>No requests in this range</div>
              <div style={{ color: "var(--tx2)", maxWidth: "420px", textWrap: "pretty" }}>{emptyText}</div>
              <button style={{ marginTop: "8px", height: "32px", padding: "0 14px", borderRadius: "8px", border: "0", background: "var(--acc)", color: "#fff", font: "inherit", fontWeight: "600", cursor: "pointer" }} onClick={showLast30}>Show last 30 days</button>
            </div>
          </>)}

          {(isError) && (<>
            <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", padding: "56px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", textAlign: "center" }}>
              <span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "36px", color: "var(--red)" }}>error</span>
              <div style={{ fontSize: "16px", fontWeight: "600" }}>Couldn&apos;t load spend data</div>
              <div style={{ color: "var(--tx2)", maxWidth: "460px", textWrap: "pretty" }}>{errorText}</div>
              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}><button onClick={retry} style={{ height: "32px", padding: "0 14px", borderRadius: "8px", border: "0", background: "var(--acc)", color: "#fff", font: "inherit", fontWeight: "600", cursor: "pointer" }}>Retry</button><button style={{ height: "32px", padding: "0 14px", borderRadius: "8px", border: "1px solid var(--line2)", background: "var(--card)", color: "var(--tx)", font: "inherit", cursor: "pointer" }} onClick={openConsole}>Open Console Log</button></div>
            </div>
          </>)}

          {(s.top) && (<>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: "16px" }}>
              <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontSize: "11.5px", fontWeight: "600", letterSpacing: ".05em", color: "var(--tx2)", display: "flex", gap: "8px", alignItems: "center" }}>REAL SPEND<span style={{ fontSize: "10px", letterSpacing: ".02em", fontWeight: "600", padding: "1px 6px", borderRadius: "4px", background: "var(--seg)", color: "var(--tx2)" }}>FROM PROVIDER</span></span><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "18px", color: "var(--acc)" }}>account_balance_wallet</span></div>
                <div style={{ fontSize: "30px", fontWeight: "650", letterSpacing: "-.02em", color: "var(--acc)", fontVariantNumeric: "tabular-nums" }}>{k.real}</div>
                <div style={{ fontSize: "12px", color: "var(--tx2)" }}>Paid to OpenRouter {k.or} and DeepSeek {k.ds}</div>
              </div>
              <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontSize: "11.5px", fontWeight: "600", letterSpacing: ".05em", color: "var(--tx2)", display: "flex", gap: "8px", alignItems: "center" }}>SUBSCRIPTION VALUE<span style={{ fontSize: "10px", letterSpacing: ".02em", fontWeight: "600", padding: "1px 6px", borderRadius: "4px", background: "var(--violetbg)", color: "var(--violet)" }}>ESTIMATE</span></span><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "18px", color: "var(--violet)" }}>workspace_premium</span></div>
                <div style={{ fontSize: "30px", fontWeight: "650", letterSpacing: "-.02em", color: "var(--violet)", fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
                <div style={{ fontSize: "12px", color: "var(--tx2)" }}>Subscription calls at API list price. Not billed.</div>
              </div>
              <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontSize: "11.5px", fontWeight: "600", letterSpacing: ".05em", color: "var(--tx2)" }}>VALUE PER USD OF FEES</span><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "18px", color: "var(--green)" }}>trending_up</span></div>
                <div style={{ fontSize: "30px", fontWeight: "650", letterSpacing: "-.02em", color: "var(--green)", fontVariantNumeric: "tabular-nums" }}>{k.ratio}</div>
                <div style={{ fontSize: "12px", color: "var(--tx2)" }}>{k.ratioSub}</div>
              </div>
            </div>
          </>)}

          {(s.real) && (<>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: "16px" }}>
              <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}><div style={{ display: "flex", flexDirection: "column", gap: "2px" }}><span style={{ fontWeight: "600", fontSize: "14px" }}>OpenRouter</span><span style={{ fontSize: "11.5px", color: "var(--tx3)" }}>{or.sub}</span></div><span style={{ fontSize: "10.5px", fontWeight: "600", padding: "2px 7px", borderRadius: "5px", background: "var(--acc2)", color: "var(--acc)" }}>REAL MONEY</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "8px 10px", borderRadius: "8px", background: "var(--seg)" }}><span style={{ fontSize: "11px", color: "var(--tx2)" }}>Today</span><span style={{ fontWeight: "600", fontSize: "15px", fontVariantNumeric: "tabular-nums" }}>{or.today}</span></div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "8px 10px", borderRadius: "8px", background: "var(--seg)" }}><span style={{ fontSize: "11px", color: "var(--tx2)" }}>{or.weekLabel}</span><span style={{ fontWeight: "600", fontSize: "15px", fontVariantNumeric: "tabular-nums" }}>{or.week}</span></div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "8px 10px", borderRadius: "8px", background: "var(--seg)" }}><span style={{ fontSize: "11px", color: "var(--tx2)" }}>{or.monthLabel}</span><span style={{ fontWeight: "600", fontSize: "15px", fontVariantNumeric: "tabular-nums" }}>{or.month}</span></div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "12px" }}><span style={{ color: "var(--tx2)" }}>Spent in range · {rangeTitle}</span><span style={{ fontVariantNumeric: "tabular-nums", fontWeight: "600", color: "var(--acc)" }}>{k.or}</span></div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}><span style={{ color: "var(--tx2)" }}>{or.budgetLabel}</span><span style={{ fontVariantNumeric: "tabular-nums" }}><b>{or.budgetUsed}</b> of {or.budgetCap}</span></div>
                  <div style={{ height: "6px", borderRadius: "3px", background: "var(--seg)", overflow: "hidden" }}><div style={{ width: or.budgetW, height: "100%", background: or.budgetC }}></div></div>
                  <div style={{ fontSize: "11px", color: "var(--tx3)" }}>{or.budgetReset}</div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderTop: "1px solid var(--line)", paddingTop: "10px" }}><span style={{ color: "var(--tx2)", fontSize: "12px" }}>Credit balance</span><span style={{ fontWeight: "600", fontSize: "15px" }}>{or.balance}</span></div>
              </div>
              <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}><div style={{ display: "flex", flexDirection: "column", gap: "2px" }}><span style={{ fontWeight: "600", fontSize: "14px" }}>DeepSeek</span><span style={{ fontSize: "11.5px", color: "var(--tx3)" }}>{ds.sub}</span></div><span style={{ fontSize: "10.5px", fontWeight: "600", padding: "2px 7px", borderRadius: "5px", background: "var(--acc2)", color: "var(--acc)" }}>REAL MONEY</span></div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}><span style={{ fontSize: "28px", fontWeight: "650", fontVariantNumeric: "tabular-nums" }}>{ds.balance}</span>{(ds.extra) && (<span style={{ color: "var(--tx3)" }}>{ds.extra}</span>)}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--tx2)" }}>Spent in range · {rangeTitle}</span><span style={{ fontVariantNumeric: "tabular-nums", fontWeight: "600", color: "var(--acc)" }}>{k.ds}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--tx2)" }}>{ds.monthLabel}</span><span style={{ fontVariantNumeric: "tabular-nums", fontWeight: "600" }}>{ds.month}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--tx2)" }}>Balance lasts at 30-day rate</span><span style={{ fontWeight: "600" }}>{ds.runway}</span></div>
                </div>
              </div>
              <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={{ fontSize: "11.5px", fontWeight: "600", letterSpacing: ".05em", color: "var(--tx2)" }}>{trend.title}</span><span style={{ fontSize: "11.5px", color: "var(--tx3)" }}>{trend.peak}</span></div>
                <div style={{ position: "relative", height: "120px" }}>
                  {(trend.hasNl) && (<><div style={{ position: "absolute", left: "0", top: "0", bottom: "0", width: trend.nlW, background: "repeating-linear-gradient(135deg,transparent 0 5px,var(--line2) 5px 6px)", borderRight: "1px dashed var(--tx3)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}><span style={{ fontSize: "10.5px", color: "var(--tx2)", background: "var(--card)", padding: "1px 6px", borderRadius: "4px", whiteSpace: "nowrap" }}>not logged</span></div></>)}
                  <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ position: "absolute", inset: "0", width: "100%", height: "100%", overflow: "visible" }}>
                    <line x1="0" y1="40" x2="100" y2="40" stroke="var(--line2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    <line x1="0" y1="20" x2="100" y2="20" stroke="var(--line)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                    {(trend.line) && (<><polygon points={trend.area} fill="var(--acc)" opacity=".12" />
                    <polyline points={trend.line} fill="none" stroke="var(--acc)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" /></>)}
                  </svg>
                  <span style={{ position: "absolute", right: "0", top: "-2px", fontSize: "10.5px", color: "var(--tx3)" }}>{trend.max}</span>
                  <span style={{ position: "absolute", right: "0", top: "44%", fontSize: "10.5px", color: "var(--tx3)" }}>{trend.mid}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5px", color: "var(--tx3)" }}><span>{trend.from}</span><span>{trend.to}</span></div>
                <div style={{ fontSize: "11px", color: "var(--tx3)" }}>{loggedNote}</div>
              </div>
            </div>
          </>)}

          {(s.time) && (<>
            <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "11.5px", fontWeight: "600", letterSpacing: ".05em", color: "var(--tx2)" }}>{chart.title}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--tx2)" }}><span style={{ width: "10px", height: "10px", borderRadius: "2px", background: "var(--acc)" }}></span>Real spend</span>
                  <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--tx2)" }}><span style={{ width: "10px", height: "10px", borderRadius: "2px", background: "var(--violet)" }}></span>Subscription value (estimate)</span>
                  {(chart.hasNl) && (<><span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--tx2)" }}><span style={{ width: "10px", height: "10px", borderRadius: "2px", border: "1px solid var(--line2)", background: "repeating-linear-gradient(135deg,transparent 0 2px,var(--tx3) 2px 3px)" }}></span>Real spend not logged</span></>)}
                </div>
                <div style={{ fontSize: "12px", color: "var(--tx2)", fontVariantNumeric: "tabular-nums", display: "flex", gap: "12px" }}><b style={{ color: "var(--tx)" }}>{readout.label}</b><span>Real <b style={{ color: "var(--acc)" }}>{readout.real}</b></span><span>Value <b style={{ color: "var(--violet)" }}>{readout.value}</b></span></div>
              </div>
              <div style={{ position: "relative", height: "220px", marginLeft: "44px" }}>
                {(chart.grid).map((g, _i) => (<Fragment key={_i}>
                  <div style={{ position: "absolute", left: "0", right: "0", bottom: g.b, borderTop: "1px dashed var(--line)", height: "0" }}><span style={{ position: "absolute", left: "-44px", top: "-7px", width: "38px", textAlign: "right", fontSize: "10.5px", color: "var(--tx3)" }}>{g.label}</span></div>
                </Fragment>))}
                <div style={{ position: "absolute", inset: "0", display: "flex", alignItems: "flex-end", gap: chart.gap, borderBottom: "1px solid var(--line2)" }}>
                  {(chart.bars).map((b, _i) => (<Fragment key={_i}>
                    <div onMouseEnter={b.hover} style={{ flex: "1", minWidth: "0", height: "100%", display: "flex", flexDirection: "column-reverse", cursor: "default", background: b.bg, borderRadius: "3px 3px 0 0" }}>
                      <div style={{ height: b.realH, background: "var(--acc)", flex: "none" }}></div>
                      <div style={{ height: b.valH, background: "var(--violet)", opacity: b.op, borderRadius: "3px 3px 0 0", flex: "none" }}></div>
                      {(b.future) && (<><div style={{ height: "100%", border: "1px dashed var(--line2)", borderBottom: "0", borderRadius: "3px 3px 0 0", boxSizing: "border-box" }}></div></>)}
                    </div>
                  </Fragment>))}
                </div>
              </div>
              <div style={{ display: "flex", gap: chart.gap, marginLeft: "44px" }}>
                {(chart.bars).map((b, _i) => (<Fragment key={_i}><div style={{ flex: "1", minWidth: "0", fontSize: "10.5px", color: "var(--tx3)", whiteSpace: "nowrap", overflow: "visible" }}>{b.tick}</div></Fragment>))}
              </div>
              <div style={{ fontSize: "11.5px", color: "var(--tx3)" }}>{chart.note}</div>
            </div>
          </>)}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,440px),1fr))", gap: "16px", alignItems: "start" }}>
            {(s.allowance) && (<>
              <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "4px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingBottom: "8px" }}><span style={{ fontSize: "11.5px", fontWeight: "600", letterSpacing: ".05em", color: "var(--tx2)" }}>ALLOWANCE LEFT <span style={{ fontWeight: "400", letterSpacing: "0", color: "var(--tx3)" }}>· right now, worst window</span></span><a href="/dashboard/quota" style={{ fontSize: "12px" }}>Details in Quota Tracker →</a></div>
                {(allowance).map((a, _i) => (<Fragment key={_i}>
                  <div style={{ display: "grid", gridTemplateColumns: "150px 1fr 96px", gap: "14px", alignItems: "center", padding: "9px 0", borderTop: "1px solid var(--line)" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "1px", minWidth: "0" }}><span style={{ fontWeight: "600" }}>{a.name}</span><span style={{ fontSize: "11.5px", color: "var(--tx3)" }}>{a.win}</span></div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <div style={{ height: "8px", borderRadius: "4px", background: "var(--seg)", overflow: "hidden" }}><div style={{ height: "100%", width: a.w, background: a.c, borderRadius: "4px" }}></div></div>
                      <span style={{ fontSize: "11.5px", color: a.c, fontWeight: "600" }}>{a.usedLabel}</span>
                    </div>
                    <div style={{ textAlign: "right", fontSize: "12px", color: "var(--tx2)" }}>resets in<br /><b style={{ color: "var(--tx)", fontVariantNumeric: "tabular-nums" }}>{a.reset}</b></div>
                  </div>
                </Fragment>))}
                <div style={{ display: "flex", gap: "14px", fontSize: "11px", color: "var(--tx3)", paddingTop: "6px" }}><span style={{ display: "flex", gap: "5px", alignItems: "center" }}><span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "var(--green)" }}></span>under 70%</span><span style={{ display: "flex", gap: "5px", alignItems: "center" }}><span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "var(--amber)" }}></span>70–90%</span><span style={{ display: "flex", gap: "5px", alignItems: "center" }}><span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "var(--red)" }}></span>over 90%</span></div>
              </div>
            </>)}
            {(s.subvalue) && (<>
              <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "4px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "8px" }}><span style={{ fontSize: "11.5px", fontWeight: "600", letterSpacing: ".05em", color: "var(--tx2)", display: "flex", gap: "8px", alignItems: "center" }}>SUBSCRIPTION VALUE<span style={{ fontSize: "10px", fontWeight: "600", padding: "1px 6px", borderRadius: "4px", background: "var(--violetbg)", color: "var(--violet)" }}>ESTIMATE</span></span>
                  {(notEditing) && (<><button onClick={startEdit} style={{ height: "28px", padding: "0 10px", borderRadius: "7px", border: "1px solid var(--line2)", background: "var(--card)", color: "var(--tx)", font: "inherit", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px" }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "15px" }}>edit</span>Edit fees</button></>)}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr .8fr", gap: "10px", fontSize: "11px", fontWeight: "600", color: "var(--tx3)", letterSpacing: ".04em", padding: "4px 0" }}><span>SUBSCRIPTION</span><span style={{ textAlign: "right" }}>FEE / MONTH</span><span style={{ textAlign: "right" }}>VALUE IN RANGE</span><span style={{ textAlign: "right" }}>RATIO</span></div>
                {(subs).map((r, _i) => (<Fragment key={_i}>
                  <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr .8fr", gap: "10px", alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--line)", fontVariantNumeric: "tabular-nums" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}><span style={{ fontWeight: "600" }}>{r.name}</span><span style={{ fontSize: "11.5px", color: "var(--tx3)" }}>{r.plan}</span></div>
                    <div style={{ textAlign: "right" }}>
                      {(r.inputReady) && (<><input type="number" placeholder="Not set" ref={r.ref} value={r.draft} onChange={r.onFee} style={{ width: "80px", height: "28px", boxSizing: "border-box", border: "1px solid var(--line2)", borderRadius: "7px", padding: "0 8px", background: "var(--bg)", color: "var(--tx)", font: "inherit", textAlign: "right" }} /></>)}
                      {(r.showFee) && (<><span>{r.fee}</span></>)}{(r.showSet) && (<><button onClick={r.setFee} style={{ border: "0", background: "transparent", padding: "0", font: "inherit", color: "var(--tx3)", textDecoration: "underline dotted", textUnderlineOffset: "3px", cursor: "pointer" }} className="r9-hacc">Not set</button></>)}
                    </div>
                    <div style={{ textAlign: "right", color: "var(--violet)", fontWeight: "600" }}>{r.value}</div>
                    <div style={{ textAlign: "right", fontWeight: "650", color: r.c }}>{r.ratio}</div>
                  </div>
                </Fragment>))}
                {(editing) && (<>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", paddingTop: "10px", borderTop: "1px solid var(--line)" }}><span style={{ fontSize: "11.5px", color: "var(--tx3)" }}>Saved to 9Router settings.</span><div style={{ display: "flex", gap: "6px" }}><button onClick={cancelEdit} style={{ height: "28px", padding: "0 10px", borderRadius: "7px", border: "1px solid var(--line2)", background: "var(--card)", color: "var(--tx)", font: "inherit", fontSize: "12px", cursor: "pointer" }}>Cancel</button><button onClick={saveEdit} style={{ height: "28px", padding: "0 12px", borderRadius: "7px", border: "0", background: "var(--acc)", color: "#fff", font: "inherit", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}>Save fees</button></div></div>
                </>)}
                {(notEditing) && (<>
                  <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "10px", borderTop: "1px solid var(--line)", fontVariantNumeric: "tabular-nums", fontWeight: "600" }}><span>Total <span style={{ fontWeight: "400", color: "var(--tx3)" }}>· fees prorated to {dayCount} days</span></span><span>{k.feesPro} → <span style={{ color: "var(--violet)" }}>{k.value}</span> · <span style={{ color: "var(--green)" }}>{k.ratio}</span></span></div>
                </>)}
              </div>
            </>)}
          </div>

          {(s.breakdown) && (<>
            <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "4px", overflowX: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", paddingBottom: "8px", flexWrap: "wrap" }}><span style={{ fontSize: "11.5px", fontWeight: "600", letterSpacing: ".05em", color: "var(--tx2)" }}>BREAKDOWN</span>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}><span style={{ fontSize: "12px", color: "var(--tx3)" }}>Group by</span><div style={{ display: "flex", flexWrap: "wrap", gap: "2px", padding: "3px", borderRadius: "9px", background: "var(--seg)" }}>{(groups).map((g, _i) => (<Fragment key={_i}><button onClick={g.on} style={g.style}>{g.label}</button></Fragment>))}</div></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,2fr) 1fr 1fr 1fr 1.1fr minmax(140px,1.6fr)", gap: "12px", fontSize: "11px", fontWeight: "600", color: "var(--tx3)", letterSpacing: ".04em", padding: "6px 0", minWidth: "760px" }}><span>{groupHead}</span><span style={{ textAlign: "right" }}>REQUESTS</span><span style={{ textAlign: "right" }}>TOKENS</span><span style={{ textAlign: "right" }}>REAL SPEND</span><span style={{ textAlign: "right" }}>LIST-PRICE VALUE</span><span>SHARE OF VALUE</span></div>
              {(rows).map((r, _i) => (<Fragment key={_i}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,2fr) 1fr 1fr 1fr 1.1fr minmax(140px,1.6fr)", gap: "12px", alignItems: "center", padding: "9px 0", borderTop: "1px solid var(--line)", fontVariantNumeric: "tabular-nums", minWidth: "760px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}><span style={{ fontFamily: "var(--mono)", fontSize: "12.5px" }}>{r.name}</span><span style={{ fontSize: "11.5px", color: "var(--tx3)" }}>{r.desc}</span>{(r.hasMix) && (<><div style={{ display: "flex", width: "170px", maxWidth: "100%", height: "6px", borderRadius: "3px", overflow: "hidden", gap: "1px", marginTop: "2px" }}>{(r.mix).map((m, _i) => (<Fragment key={_i}><span title={m.t} style={{ width: m.w, background: m.c }}></span></Fragment>))}</div></>)}</div>
                  <span style={{ textAlign: "right" }}>{r.req}</span>
                  <span style={{ textAlign: "right", color: "var(--tx2)" }}>{r.tok}</span>
                  <span style={{ textAlign: "right", fontWeight: "600", color: r.realC }}>{r.real}</span>
                  <span style={{ textAlign: "right", color: "var(--violet)" }}>{r.value}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><div style={{ flex: "1", height: "6px", borderRadius: "3px", background: "var(--seg)", overflow: "hidden" }}><div style={{ width: r.share, height: "100%", background: "var(--violet)", borderRadius: "3px" }}></div></div><span style={{ width: "40px", textAlign: "right", fontSize: "11.5px", color: "var(--tx2)" }}>{r.shareL}</span></div>
                </div>
              </Fragment>))}
              <div style={{ fontSize: "11px", color: "var(--tx3)", paddingTop: "8px" }}>{bdNote}</div>
            </div>
          </>)}

          {(s.agents) && (<>
            <div ref={aPanel} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "8px", minWidth: "0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}><span style={{ fontSize: "11.5px", fontWeight: "600", letterSpacing: ".05em", color: "var(--tx2)" }}>AGENTS AND SESSIONS</span><span style={{ fontSize: "11.5px", color: "var(--tx3)" }}>{ag.sub}</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  {(ag.filter) && (<><button onClick={ag.clearFilter} style={{ display: "flex", alignItems: "center", gap: "4px", height: "26px", padding: "0 6px 0 10px", borderRadius: "13px", border: "0", background: "var(--acc2)", color: "var(--acc)", font: "inherit", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}>Session {ag.filter}<span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "16px" }}>close</span></button></>)}
                  <div style={{ display: "flex", gap: "2px", padding: "3px", borderRadius: "9px", background: "var(--seg)" }}>{(ag.views).map((g, _i) => (<Fragment key={_i}><button onClick={g.on} style={g.style}>{g.label}</button></Fragment>))}</div>
                </div>
              </div>
              {(ag.loading) && (<>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "4px 0" }}>{(ag.skel).map((k, _i) => (<Fragment key={_i}><div style={{ display: "flex", gap: "12px", alignItems: "center" }}><div style={{ width: "70px", height: "12px", borderRadius: "6px", background: "var(--seg)" }}></div><div style={{ width: "90px", height: "12px", borderRadius: "6px", background: "var(--seg)" }}></div><div style={{ width: k.w, height: "12px", borderRadius: "6px", background: "var(--seg)" }}></div><div style={{ flex: "1", height: "6px", borderRadius: "3px", background: "var(--seg)" }}></div></div></Fragment>))}<span style={{ fontSize: "12px", color: "var(--tx3)" }}>Reading sessions…</span></div>
              </>)}
              {(ag.error) && (<>
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "12px", padding: "14px 16px", borderRadius: "9px", background: "var(--redbg)", boxSizing: "border-box", minHeight: "64px" }}><span style={{ flex: "none", fontFamily: "'Material Symbols Outlined'", fontSize: "22px", color: "var(--red)" }}>error</span><div style={{ flex: "1 1 220px", minWidth: "0", display: "flex", flexDirection: "column", gap: "2px" }}><span style={{ fontWeight: "600" }}>Couldn&apos;t load sessions</span><span style={{ fontSize: "12px", color: "var(--tx2)" }}>{ag.errorText}</span></div><button onClick={ag.retry} style={{ flex: "none", alignSelf: "center", height: "28px", padding: "0 12px", borderRadius: "7px", border: "1px solid var(--line2)", background: "var(--card)", color: "var(--tx)", font: "inherit", fontSize: "12px", cursor: "pointer" }}>Retry</button></div>
              </>)}
              {(ag.empty) && (<>
                <div style={{ padding: "28px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", textAlign: "center", border: "1px dashed var(--line2)", borderRadius: "9px", background: "repeating-linear-gradient(135deg,transparent 0 6px,var(--seg) 6px 7px)" }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "28px", color: "var(--tx3)" }}>groups</span><span style={{ fontWeight: "600" }}>{ag.emptyTitle}</span><span style={{ fontSize: "12px", color: "var(--tx2)", maxWidth: "440px" }}>{ag.emptyText}</span></div>
              </>)}
              {(ag.showSessions) && (<>
                <div ref={aRef} onScroll={checkFade} style={{ overflowX: "auto", WebkitMaskImage: maskA, maskImage: maskA }}>
                  <div style={{ display: "grid", gridTemplateColumns: "76px 90px 92px minmax(230px,1.6fr) 56px 76px 96px 54px 66px minmax(90px,1fr)", gap: "10px", fontSize: "11px", fontWeight: "600", color: "var(--tx3)", letterSpacing: ".04em", padding: "4px 0", minWidth: "1060px" }}><span>SESSION</span><span>CLIENT</span><span>ROLE</span><span>MODELS</span><span style={{ textAlign: "right" }}>REQ.</span><span style={{ textAlign: "right" }}>DURATION</span><span>STARTED</span><span style={{ textAlign: "right" }}>REAL</span><span style={{ textAlign: "right" }}>VALUE</span><span>SHARE</span></div>
                  {(ag.sessions).map((x, _i) => (<Fragment key={_i}>
                    <div style={{ borderTop: "1px solid var(--line)", minWidth: "1060px" }}>
                      <div onClick={x.toggle} role="button" tabIndex={0} aria-expanded={x.open} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); x.toggle(); } }} style={{ display: "grid", gridTemplateColumns: "76px 90px 92px minmax(230px,1.6fr) 56px 76px 96px 54px 66px minmax(90px,1fr)", gap: "10px", alignItems: "center", padding: "7px 0", fontSize: "12px", fontVariantNumeric: "tabular-nums", cursor: "pointer", background: x.bg }}>
                        <span style={{ display: "flex", alignItems: "center", gap: "3px", fontFamily: "var(--mono)", fontSize: "11.5px", color: "var(--tx)" }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: "15px", color: "var(--tx3)" }}>{x.chev}</span>{x.id}</span>
                        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.client}</span>
                        <span><span style={{ fontSize: "10.5px", fontWeight: "600", padding: "2px 7px", borderRadius: "5px", background: x.roleBg, color: x.roleC }}>{x.role}</span></span>
                        <span style={{ display: "flex", gap: "4px", alignItems: "center", minWidth: "0", overflow: "hidden" }}>{(x.chips).map((c, _i) => (<Fragment key={_i}><span title={c.full} style={{ flex: "none", fontFamily: "var(--mono)", fontSize: "10.5px", padding: "1px 6px", borderRadius: "4px", background: "var(--seg)", color: "var(--tx2)", whiteSpace: "nowrap" }}>{c.short}</span></Fragment>))}{(x.more) && (<><span title={x.moreTip} style={{ flex: "none", fontSize: "10.5px", fontWeight: "600", color: "var(--tx3)" }}>{x.more}</span></>)}</span>
                        <span style={{ textAlign: "right" }}>{x.req}</span>
                        <span style={{ textAlign: "right", color: "var(--tx2)" }}>{x.dur}</span>
                        <span style={{ color: "var(--tx2)", whiteSpace: "nowrap" }}>{x.started}</span>
                        <span style={{ textAlign: "right", fontWeight: "600", color: x.realC }}>{x.real}</span>
                        <span style={{ textAlign: "right", fontWeight: "600", color: "var(--violet)" }}>{x.value}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}><div style={{ flex: "1", height: "6px", borderRadius: "3px", background: "var(--seg)", overflow: "hidden" }}><div style={{ width: x.share, height: "100%", background: "var(--violet)", borderRadius: "3px" }}></div></div><span style={{ width: "36px", textAlign: "right", fontSize: "11px", color: "var(--tx2)" }}>{x.shareL}</span></div>
                      </div>
                      {(x.open) && (<>
                        <div style={{ position: "sticky", left: "0", boxSizing: "border-box", width: aWpx, display: "grid", gridTemplateColumns: detCols, gap: "16px 20px", padding: "10px 12px 14px 22px", marginBottom: "8px", borderRadius: "9px", background: "var(--seg)" }}>
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr) 44px auto", gap: "8px", fontSize: "10.5px", fontWeight: "600", letterSpacing: ".04em", color: "var(--tx3)", paddingBottom: "4px" }}><span>MODEL</span><span>PROVIDER</span><span style={{ textAlign: "right" }}>REQ.</span><span style={{ textAlign: "right" }}>VALUE</span></div>
                            {(x.models).map((m, _i) => (<Fragment key={_i}><div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr) 44px auto", gap: "8px", fontSize: "12px", padding: "4px 0", borderTop: "1px solid var(--line2)", fontVariantNumeric: "tabular-nums" }}><span style={{ fontFamily: "var(--mono)", fontSize: "11.5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.m}</span><span style={{ color: "var(--tx2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.prov}</span><span style={{ textAlign: "right" }}>{m.req}</span><span style={{ textAlign: "right", color: "var(--violet)", fontWeight: "600", whiteSpace: "nowrap" }}>{m.v}</span></div></Fragment>))}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                            <span style={{ fontSize: "10.5px", fontWeight: "600", letterSpacing: ".04em", color: "var(--tx3)" }}>REQUESTS OVER TIME</span>
                            <div style={{ position: "relative", height: "30px", borderRadius: "6px", background: "var(--card)", border: "1px solid var(--line2)" }}>{(x.ticks).map((t, _i) => (<Fragment key={_i}><span style={{ position: "absolute", top: "7px", width: "2px", height: "16px", borderRadius: "1px", background: "var(--violet)", opacity: ".75", left: t.l }}></span></Fragment>))}</div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--tx3)" }}><span>{x.tStart}</span><span>{x.tEnd}</span></div>
                            <span style={{ fontSize: "11.5px", color: "var(--tx2)" }}>{x.sumLine}</span>
                          </div>
                        </div>
                      </>)}
                    </div>
                  </Fragment>))}
                </div>
              </>)}
              {(ag.showRoles) && (<>
                <div ref={rRef} onScroll={checkFade} style={{ overflowX: "auto", WebkitMaskImage: maskR, maskImage: maskR }}>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(150px,1.4fr) 90px 120px 100px 80px minmax(120px,1.2fr)", gap: "12px", fontSize: "11px", fontWeight: "600", color: "var(--tx3)", letterSpacing: ".04em", padding: "4px 0", minWidth: "680px" }}><span>ROLE</span><span style={{ textAlign: "right" }}>SESSIONS</span><span style={{ textAlign: "right" }}>AVG / SESSION</span><span style={{ textAlign: "right" }}>TOTAL VALUE</span><span style={{ textAlign: "right" }}>REAL</span><span>SHARE OF VALUE</span></div>
                  {(ag.roles).map((r, _i) => (<Fragment key={_i}>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(150px,1.4fr) 90px 120px 100px 80px minmax(120px,1.2fr)", gap: "12px", alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--line)", fontSize: "12.5px", fontVariantNumeric: "tabular-nums", minWidth: "680px" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ fontSize: "11px", fontWeight: "600", padding: "2px 8px", borderRadius: "5px", background: r.bg, color: r.c }}>{r.role}</span><span style={{ fontSize: "11.5px", color: "var(--tx3)" }}>{r.desc}</span></span>
                      <span style={{ textAlign: "right" }}>{r.sessions}</span>
                      <span style={{ textAlign: "right", color: "var(--tx2)" }}>{r.avg}</span>
                      <span style={{ textAlign: "right", fontWeight: "600", color: "var(--violet)" }}>{r.total}</span>
                      <span style={{ textAlign: "right", fontWeight: "600", color: r.realC }}>{r.real}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}><div style={{ flex: "1", height: "6px", borderRadius: "3px", background: "var(--seg)", overflow: "hidden" }}><div style={{ width: r.share, height: "100%", background: "var(--violet)", borderRadius: "3px" }}></div></div><span style={{ width: "40px", textAlign: "right", fontSize: "11px", color: "var(--tx2)" }}>{r.shareL}</span></div>
                    </div>
                  </Fragment>))}
                </div>
              </>)}
              <div style={{ fontSize: "11px", color: "var(--tx3)" }}>{ag.note}</div>
            </div>
          </>)}

          {(s.outliers) && (<>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,380px),1fr))", gap: "16px", alignItems: "start" }}>
              <div ref={oRef} style={{ gridColumn: "1/-1", minWidth: "0", background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "4px", overflowX: "auto" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", paddingBottom: "8px", flexWrap: "wrap" }}><span style={{ fontSize: "11.5px", fontWeight: "600", letterSpacing: ".05em", color: "var(--tx2)" }}>TOP 10 REQUESTS <span style={{ fontWeight: "400", letterSpacing: "0", color: "var(--tx3)" }}>· most expensive in range</span></span>
                  <div style={{ display: "flex", gap: "2px", padding: "3px", borderRadius: "9px", background: "var(--seg)" }}>{(rankBtns).map((g, _i) => (<Fragment key={_i}><button onClick={g.on} style={g.style}>{g.label}</button></Fragment>))}</div>
                </div>
                {(outliers).map((o, _i) => (<Fragment key={_i}>
                  {(o.wide) && (<>
                  <div style={{ display: "grid", gridTemplateColumns: "22px 100px minmax(120px,1.1fr) minmax(150px,1.4fr) 84px 70px 52px 62px 50px", gap: "10px", alignItems: "center", padding: "7px 0", borderTop: "1px solid var(--line)", fontVariantNumeric: "tabular-nums", minWidth: "830px" }}>
                    <span style={{ color: "var(--tx3)", fontSize: "11.5px" }}>{o.rank}</span>
                    <span style={{ fontSize: "12px", color: "var(--tx2)" }}>{o.when}</span>
                    <span title={o.modelFull} style={{ fontFamily: "var(--mono)", fontSize: "12px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.model}</span>
                    <span style={{ fontSize: "12px", color: "var(--tx2)", display: "flex", gap: "6px", alignItems: "center", minWidth: "0", overflow: "hidden" }}><span title={o.key} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: "0", flex: "0 1 auto" }}>{o.key}</span>{(o.combo) && (<><span style={{ flex: "none", whiteSpace: "nowrap", fontSize: "10.5px", padding: "1px 6px", borderRadius: "4px", background: "var(--seg)", color: "var(--tx2)" }}>{o.combo}</span></>)}{(o.flag) && (<><span style={{ flex: "none", fontSize: "10.5px", padding: "1px 6px", borderRadius: "4px", background: "var(--redbg)", color: "var(--red)", fontWeight: "600", whiteSpace: "nowrap" }}>burst</span></>)}</span>
                    <span style={{ fontSize: "12px", color: "var(--tx2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.client}</span>
                    <span style={{ whiteSpace: "nowrap" }}>{(o.hasSess) && (<><button onClick={o.goSess} title="Show this session in Agents and sessions" style={{ border: "0", background: "transparent", padding: "0", fontFamily: "var(--mono)", fontSize: "11.5px", color: "var(--acc)", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: "2px" }}>{o.sess}</button></>)}{(o.noSess) && (<><span title={nrTip} style={{ fontSize: "11.5px", color: "var(--tx3)" }}>n/a</span></>)}</span>
                    <span style={{ textAlign: "right", fontSize: "12px", color: "var(--tx3)" }}>{o.tok}</span>
                    <span style={{ textAlign: "right", color: "var(--violet)", fontWeight: "600" }}>{o.value}</span>
                    <span title={o.realTip} style={{ textAlign: "right", fontWeight: "600", color: o.realC, whiteSpace: "nowrap" }}>{o.real}</span>
                  </div>
                  </>)}
                  {(o.narrow) && (<>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "8px 0", borderTop: "1px solid var(--line)", fontVariantNumeric: "tabular-nums" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "10px", minWidth: "0" }}>
                      <span style={{ color: "var(--tx3)", fontSize: "11.5px", width: "18px", flex: "none" }}>{o.rank}</span>
                      <span style={{ fontSize: "12px", color: "var(--tx2)", whiteSpace: "nowrap", flex: "none" }}>{o.when}</span>
                      <span title={o.modelFull} style={{ fontFamily: "var(--mono)", fontSize: "12px", flex: "1", minWidth: "0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.model}</span>
                      <span style={{ color: "var(--violet)", fontWeight: "600", flex: "none" }}>{o.value}</span>
                      <span title={o.realTip} style={{ fontWeight: "600", color: o.realC, whiteSpace: "nowrap", flex: "none", minWidth: "34px", textAlign: "right" }}>{o.real}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", paddingLeft: "28px", fontSize: "12px", color: "var(--tx2)" }}>
                      <span>{o.key}</span>
                      {(o.combo) && (<><span style={{ fontSize: "10.5px", padding: "1px 6px", borderRadius: "4px", background: "var(--seg)", color: "var(--tx2)" }}>{o.combo}</span></>)}
                      {(o.flag) && (<><span style={{ fontSize: "10.5px", padding: "1px 6px", borderRadius: "4px", background: "var(--redbg)", color: "var(--red)", fontWeight: "600" }}>burst</span></>)}
                      <span style={{ color: "var(--tx3)" }}>·</span><span>{o.client}</span><span style={{ color: "var(--tx3)" }}>·</span>
                      {(o.hasSess) && (<><button onClick={o.goSess} style={{ border: "0", background: "transparent", padding: "0", fontFamily: "var(--mono)", fontSize: "11.5px", color: "var(--acc)", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: "2px" }}>{o.sess}</button></>)}{(o.noSess) && (<><span title={nrTip} style={{ fontSize: "11.5px", color: "var(--tx3)" }}>n/a</span></>)}
                      <span style={{ color: "var(--tx3)", marginLeft: "auto" }}>{o.tok} tok</span>
                    </div>
                  </div>
                  </>)}
                </Fragment>))}
                {(noOutliers) && (<><div style={{ padding: "24px 0", textAlign: "center", color: "var(--tx3)" }}>No requests in this range.</div></>)}
                <div style={{ fontSize: "11px", color: "var(--tx3)", paddingTop: "6px" }}>{outNote}</div>
              </div>
              <div style={{ minWidth: "0", background: "var(--card)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "4px" }}>
                <div style={{ paddingBottom: "8px" }}><span style={{ fontSize: "11.5px", fontWeight: "600", letterSpacing: ".05em", color: "var(--tx2)" }}>{topDaysTitle}</span></div>
                {(topDays).map((d, _i) => (<Fragment key={_i}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "8px 0", borderTop: "1px solid var(--line)", fontVariantNumeric: "tabular-nums" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: "600" }}>{d.label}</span><span style={{ color: "var(--violet)", fontWeight: "600" }}>{d.value}</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11.5px", color: "var(--tx3)" }}><span>{d.top}</span><span>real {d.real}</span></div>
                    <div style={{ height: "4px", borderRadius: "2px", background: "var(--seg)" }}><div style={{ height: "100%", width: d.w, background: "var(--violet)", borderRadius: "2px", opacity: ".7" }}></div></div>
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
