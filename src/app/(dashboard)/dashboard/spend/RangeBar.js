"use client";

import { useState } from "react";

// Preset segment + month calendar for a custom range (design: Shared.dc.html "range").
const PRESETS = ["Today", "24h", "7D", "30D", "60D", "All"];
const seg = (on) => ({ border: 0, height: 28, padding: "0 11px", borderRadius: 7, font: "inherit", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
  background: on ? "var(--segon)" : "transparent", color: on ? "var(--tx)" : "var(--tx2)", fontWeight: on ? 600 : 400, boxShadow: on ? "0 1px 2px rgba(0,0,0,.08)" : "none" });
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmt = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function RangeBar({ preset, customLabel, onChange, today }) {
  const [open, setOpen] = useState(false);
  const [m, setM] = useState(0);
  const [a, setA] = useState(null);
  const T = today ? new Date(today + "T00:00:00") : new Date();
  const base = new Date(T.getFullYear(), T.getMonth() - m, 1);
  const off = (base.getDay() + 6) % 7, dim = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const days = [];
  for (let i = 0; i < off; i++) days.push(null);
  for (let n = 1; n <= dim; n++) days.push(new Date(base.getFullYear(), base.getMonth(), n));
  const pick = (dt) => {
    if (dt > T) return;
    if (!a) return setA(dt);
    const from = dt < a ? dt : a, to = dt < a ? a : dt, label = fmt(from) + " – " + fmt(to);
    setA(null); setOpen(false);
    onChange({ preset: "Custom", from: key(from), to: key(to), label });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, position: "relative", maxWidth: "100%" }}>
      <div style={{ display: "flex", flexWrap: "nowrap", gap: 2, padding: 3, borderRadius: 9, background: "var(--seg)", maxWidth: "100%", overflowX: "auto", boxSizing: "border-box" }}>
        {PRESETS.map((k) => <button key={k} onClick={() => { setOpen(false); onChange({ preset: k }); }} style={seg(preset === k)}>{k}</button>)}
        <button onClick={() => { setOpen((o) => !o); setA(null); }} style={seg(preset === "Custom")} aria-expanded={open}>
          <span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: 15 }}>calendar_month</span>{preset === "Custom" ? customLabel || "Custom" : "Custom"}
        </button>
      </div>
      <span style={{ fontSize: 11, color: "var(--tx3)", display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontFamily: "'Material Symbols Outlined'", fontSize: 14 }}>schedule</span>Times in IST (UTC+5:30)</span>
      {open && (
        <div style={{ position: "absolute", top: 38, right: 0, zIndex: 60, width: 280, background: "var(--card)", border: "1px solid var(--line2)", borderRadius: 12, boxShadow: "0 12px 32px rgba(40,20,10,.16)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <button aria-label="Previous month" onClick={() => setM((x) => Math.min(x + 1, 12))} style={{ border: 0, background: "var(--seg)", color: "var(--tx2)", width: 28, height: 28, borderRadius: 7, cursor: "pointer", fontFamily: "'Material Symbols Outlined'", fontSize: 18 }}>chevron_left</button>
            <span style={{ fontWeight: 600, fontSize: 13, color: "var(--tx)" }}>{base.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
            <button aria-label="Next month" onClick={() => setM((x) => Math.max(x - 1, 0))} style={{ border: 0, background: "var(--seg)", color: "var(--tx2)", width: 28, height: 28, borderRadius: 7, cursor: "pointer", fontFamily: "'Material Symbols Outlined'", fontSize: 18 }}>chevron_right</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, fontSize: 10.5, color: "var(--tx3)", textAlign: "center" }}>{["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => <span key={d}>{d}</span>)}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
            {days.map((dt, i) => {
              if (!dt) return <span key={i} style={{ height: 30 }} />;
              const future = dt > T, isA = a && +a === +dt, isT = +dt === +T;
              return <button key={i} onClick={() => pick(dt)} disabled={future} style={{ height: 30, border: 0, borderRadius: 7, font: "inherit", fontSize: 12, cursor: future ? "default" : "pointer", background: isA ? "var(--acc)" : "transparent", color: isA ? "#fff" : future ? "var(--tx3)" : "var(--tx)", opacity: future ? 0.4 : 1, fontWeight: isT ? 700 : 400, outline: isT && !isA ? "1px solid var(--line2)" : "none" }}>{dt.getDate()}</button>;
            })}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--tx2)" }}>{a ? "Start: " + fmt(a) + ". Pick the end date." : "Pick a start date, then an end date."}</div>
        </div>
      )}
    </div>
  );
}
