// Builds the Spend page view model from /api/spend data. Ported from the
// Claude Design "Spend.dc.html" renderVals so markup bindings stay 1:1.

export const SHORT = {
  "claude-opus-5-5": "opus-5-5", "claude-haiku-5-5": "haiku-5-5", "claude-sonnet-5-5": "sonnet-5-5", "claude-fable-5-1": "fable-5-1",
  "gpt-6-luna": "luna", "gpt-6.1-terra": "terra", "gpt-6.1-sol": "sol", "gpt-6-astra": "astra",
  "muse-spark-1.3-contributor": "muse-spark", "z-ai/glm-5.3-flash": "or·glm-5.3-flash", "deepseek/deepseek-v4.1-flash": "or·deepseek-v4.1-flash",
};
const MC = {
  "claude-opus-5-5": "#7273ee", "claude-haiku-5-5": "#a9aaf7", "gpt-6-luna": "#22a892", "gpt-6.1-terra": "#4fbfa9", "gpt-6.1-sol": "#7fd1c1",
  "gpt-6-astra": "#2f8f7c", "gemini-3.8-flash": "#e0a23a", "gemini-3.8-flash-high": "#e0a23a", "muse-spark-1.3-contributor": "#c98bd6",
  "glm-5.3-flash": "#e5603e", "glm-5.3": "#f08a6c", "qwen3.8-flash": "#d4a373", "kimi-k3.1-pro": "#b56576",
  "z-ai/glm-5.3-flash": "#8a5a44", "deepseek/deepseek-v4.1-flash": "#3d5f9e", "deepseek-v4.1-flash": "#4b84e8",
};
const PROV = {
  claude: "Claude Code", codex: "OpenAI Codex", antigravity: "Antigravity", "opencode-go": "OpenCode Go", muse: "Muse",
  openrouter: "OpenRouter", deepseek: "DeepSeek", "ollama-local": "Ollama (local)", opencode: "OpenCode Free",
};
const SUBN = {
  claude: "Claude sub", codex: "ChatGPT Pro sub", antigravity: "Antigravity sub", muse: "Muse sub", "opencode-go": "OpenCode Go sub",
  openrouter: "OpenRouter · pay per token", deepseek: "DeepSeek · prepaid", "ollama-local": "local",
};
const PLAN = { claude: "Max", codex: "Pro", antigravity: "Pro", ocgo: "Go", muse: "Basic" };
const CLIENT_DESC = { "Claude Code": "Claude Code CLI", Codex: "Codex CLI", OpenCode: "OpenCode", "OpenCode Review": "open-code-review", "T3 Code": "T3 Code", Other: "other user-agents", Unknown: "no user-agent" };
const ROLE_ORDER = ["main", "implementer", "reviewer", "thinker", "scout"];
const RC = { main: ["var(--seg)", "var(--tx2)"], scout: ["var(--bluebg)", "var(--blue)"], implementer: ["var(--violetbg)", "var(--violet)"], reviewer: ["var(--greenbg)", "var(--green)"], thinker: ["var(--amberbg)", "var(--amber)"] };
const ROLEDESC = { main: "single model, direct", scout: "combo", implementer: "combo", reviewer: "combo", thinker: "combo · fusion" };

export const usd = (n, force2) => {
  if (!n) return "$0.00";
  if (n < 0.01) return "<$0.01";
  if (n >= 1000) return "$" + Math.round(n).toLocaleString("en-US");
  return "$" + n.toFixed(force2 || n < 100 ? 2 : 0);
};
export const cnt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(Math.round(n)));
const seg = (on) => ({ border: 0, height: 26, padding: "0 10px", borderRadius: 7, font: "inherit", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", background: on ? "var(--segon)" : "transparent", color: on ? "var(--tx)" : "var(--tx2)", fontWeight: on ? 600 : 400, boxShadow: on ? "0 1px 2px rgba(0,0,0,.08)" : "none" });
const durF = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? m + " min" : Math.floor(m / 60) + " h " + (m % 60) + " min"; };
const realF = (v) => (v >= 0.005 ? usd(v, 1) : v > 0 ? "<$0.01" : "—");
const short = (m) => SHORT[m] || m;
const resetIn = (iso) => {
  const ms = Date.parse(iso || "") - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const m = Math.round(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
};

// Worst (highest used %) capped window per provider, from /api/usage/{id}.
function worstWindow(entries = []) {
  let best = null;
  for (const e of entries) {
    for (const [name, q] of Object.entries(e.quotas || {})) {
      if (!q || q.unlimited || q.isCreditBalance || !(q.total > 0)) continue;
      const used = Math.round((q.used / q.total) * 100);
      if (!best || used > best.used) best = { name, used, resetAt: q.resetAt };
    }
  }
  return best;
}
const prettyWin = (n) => n.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function buildView({ data, quota, ui, set, fit, range, feeRefs, saveFees }) {
  const { totals, bars, groups: G, fees, subsMeta } = data;
  const preset = range.preset, hourly = data.range.hourly, dayCount = data.range.days;
  const loggedLabel = data.loggedSinceLabel || "today";
  const past = bars.filter((b) => !b.future);
  const anyLogged = data.loggedSince !== null && data.loggedSince < data.range.to, allLogged = data.allLogged;

  const isSet = (k) => fees[k] !== null && fees[k] !== undefined && fees[k] !== "";
  const feeSum = subsMeta.reduce((a, s) => a + (isSet(s.k) ? +fees[s.k] : 0), 0), feesPro = (feeSum * dayCount) / 30;
  const valueFeed = subsMeta.reduce((a, s) => a + (isSet(s.k) ? totals.subs[s.k] : 0), 0);
  const unset = subsMeta.filter((s) => !isSet(s.k)).map((s) => s.name);
  const ratio = feesPro ? valueFeed / feesPro : 0;

  const rangeTitle = { Today: "Today", "24h": "Last 24 hours", "7D": "Last 7 days", "30D": "Last 30 days", "60D": "Last 60 days", All: "All time", Custom: range.label || "Custom range" }[preset];
  const rangeSub = hourly ? `${data.range.first} – ${data.range.last} IST · hourly` : `${data.range.first} – ${data.range.last} · ${bars.length} days · fees prorated`;

  // Chart
  const mx = Math.max(...bars.map((b) => b.val + b.real), 0.01);
  const mag = Math.pow(10, Math.floor(Math.log10(mx)));
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= mx) || mx;
  const H = 220;
  const lastIdx = bars.length - 1 - [...bars].reverse().findIndex((b) => !b.future);
  const hi = ui.hover != null && ui.hover < bars.length ? ui.hover : lastIdx;
  const step = Math.ceil(bars.length / (hourly ? 12 : 10));
  const fmtAxis = (v) => (v >= 1000 ? "$" + (v / 1000).toFixed(1) + "k" : "$" + (v < 10 ? v.toFixed(1) : Math.round(v)));
  const chart = {
    title: hourly ? "PER HOUR (IST)" : "PER DAY (IST)",
    bars: bars.map((b, i) => {
      const nl = !b.logged && !b.future, r = nl ? 0 : b.real;
      return { realH: r > 0 ? Math.max(2, (r / nice) * H) + "px" : "0px", valH: (b.val / nice) * H + "px", op: i === hi ? 1 : 0.78,
        bg: nl ? "repeating-linear-gradient(135deg,transparent 0 4px,var(--line2) 4px 5px)" : i === hi ? "var(--seg)" : "transparent",
        future: !!b.future, tick: i % step === 0 ? b.tick : "", hover: () => set({ hover: i }) };
    }),
    hasNl: bars.some((b) => !b.logged && !b.future), gap: bars.length > 60 ? "1px" : bars.length > 24 ? "3px" : "5px",
    grid: [0.25, 0.5, 0.75, 1].map((f) => ({ b: f * 100 + "%", label: fmtAxis(nice * f) })),
    note: preset === "Today" ? "Hours that have not happened yet are outlined. Real spend under $0.01 is drawn as a 2 px marker so it stays visible."
      : "Real spend under $0.01 is drawn as a 2 px marker. Hover a bar for exact numbers.",
  };
  const hb = bars[hi] || bars[0];
  const readout = { label: hb.label, real: usd(hb.real, 1), value: usd(hb.val) };

  // Trend (real spend line)
  const rv = past.map((b) => b.real);
  const rmx = Math.max(...rv, 0.01), rpk = Math.max(...rv, 0);
  const pts = rv.map((v, i) => [(past.length > 1 ? i / (past.length - 1) : 0.5) * 100, 40 - (v / rmx) * 36]);
  const pkBar = past[rv.indexOf(rpk)];
  const P2 = (p) => p.map((n) => n.toFixed(2)).join(",");
  const trend = {
    title: hourly ? "REAL SPEND PER HOUR" : "REAL SPEND PER DAY", line: pts.map(P2).join(" "),
    area: pts.length ? pts[0][0].toFixed(2) + ",40 " + pts.map(P2).join(" ") + " " + pts[pts.length - 1][0].toFixed(2) + ",40" : "",
    hasNl: false, nlW: "0%", max: usd((rmx * 40) / 36, 1), mid: usd((rmx * 20) / 36, 1), from: past[0]?.tick || "", to: past[past.length - 1]?.tick || "",
    peak: rpk > 0 ? "Peak " + usd(rpk, 1) + " · " + (pkBar ? pkBar.label : "") : "No real spend",
  };

  // OpenRouter / DeepSeek cards from provider usage endpoints
  // Sum same-named counters across connections instead of letting the last response win.
  const sumQ = (list = []) => list.reduce((acc, e) => {
    for (const [n, q] of Object.entries(e.quotas || {})) {
      const o = acc[n];
      acc[n] = o ? { ...o, used: (o.used || 0) + (q.used || 0), total: (o.total || 0) + (q.total || 0) } : { ...q };
    }
    return acc;
  }, {});
  const orQ = sumQ(quota.openrouter);
  const orNames = (quota.openrouter || []).map((e) => e.name).filter(Boolean);
  const daily = orQ["Daily budget (USD)"];
  const bw = daily ? Math.min(100, (daily.used / daily.total) * 100) : 0;
  const or = {
    sub: `Pay per token${orNames.length ? " · " + (orNames.length > 1 ? "keys " : "key ") + orNames.join(", ") : ""} · totals from provider`,
    today: usd(orQ["Spent today (USD)"]?.used ?? 0, 1), week: usd(orQ["Spent this week (USD)"]?.used ?? 0, 1), month: usd(orQ["Spent this month (USD)"]?.used ?? 0, 1),
    weekLabel: "This week", monthLabel: "This month",
    budgetLabel: daily ? "Daily budget" : "Daily budget · not set", budgetUsed: usd(daily?.used ?? 0, 1), budgetCap: daily ? usd(daily.total, 1) : "—",
    budgetW: Math.max(0.5, bw) + "%", budgetC: bw > 90 ? "var(--red)" : bw >= 70 ? "var(--amber)" : "var(--green)",
    budgetReset: "Resets at 05:30 IST (00:00 UTC)", balance: orQ["Balance (USD)"] ? usd(orQ["Balance (USD)"].total, 1) : "—",
  };
  const dsQ = sumQ(quota.deepseek);
  const dsBal = Object.entries(dsQ).filter(([n]) => n.startsWith("Balance (")).map(([, q]) => q);
  const dsUsd = dsBal.find((q) => q.currency === "USD"), dsOther = dsBal.filter((q) => q.currency !== "USD");
  const dsRate30 = data.totals.realDs30 ?? 0;
  const dsKey = (quota.deepseek || []).map((e) => e.name).filter(Boolean).join(", ");
  const ds = {
    sub: `Prepaid balance${dsKey ? " · key " + dsKey : ""} · from provider`,
    balance: dsUsd ? usd(dsUsd.total, 1) : dsBal[0] ? `${dsBal[0].total.toFixed(2)} ${dsBal[0].currency}` : "—",
    extra: dsUsd && dsOther.length ? dsOther.map((q) => `+ ${q.total.toFixed(2)} ${q.currency}`).join(" ") : "",
    monthLabel: "Spent in last 30 days", month: usd(dsRate30, 1),
    runway: !dsUsd ? "—" : dsRate30 <= 0 ? "No spend" : dsUsd.total / dsRate30 > 120 ? "10+ years" : "~" + Math.round(dsUsd.total / dsRate30) + " months",
  };

  // Allowance
  const col = (u) => (u > 90 ? "var(--red)" : u >= 70 ? "var(--amber)" : "var(--green)");
  const CONN = { claude: "claude", codex: "codex", antigravity: "antigravity", ocgo: "opencode-go", muse: "muse" };
  const allowance = subsMeta.map((s) => {
    const w = worstWindow(quota[CONN[s.k]]);
    return w ? { name: s.name, win: prettyWin(w.name), w: w.used + "%", c: col(w.used), usedLabel: w.used + "% used", reset: resetIn(w.resetAt) }
      : { name: s.name, win: quota[CONN[s.k]] ? "No capped window" : "Not connected", w: "0%", c: "var(--tx3)", usedLabel: "—", reset: "—" };
  });

  // Subscription value table
  const draft = ui.draft || fees;
  const subs = subsMeta.map((s) => {
    const fs = isSet(s.k), fp = fs ? (+fees[s.k] * dayCount) / 30 : 0, rt = fp ? totals.subs[s.k] / fp : 0;
    const ref = (el) => { feeRefs[s.k] = el; };
    return {
      inputReady: !!ui.editing, ref, showFee: !ui.editing && fs, showSet: !ui.editing && !fs,
      setFee: () => { set({ editing: true, draft: { ...fees } }); setTimeout(() => feeRefs[s.k]?.focus(), 0); },
      name: s.name, plan: PLAN[s.k], fee: fs ? "$" + (+fees[s.k]).toFixed(0) : "Not set", draft: draft[s.k] ?? "", value: usd(totals.subs[s.k]),
      ratio: rt ? (rt >= 10 ? rt.toFixed(0) : rt.toFixed(1)) + "×" : "", c: rt < 1 ? "var(--red)" : "var(--green)",
      onFee: (e) => { const val = e.target.value; set((u) => ({ draft: { ...(u.draft || fees), [s.k]: val } })); },
    };
  });

  // Breakdown
  const list = totals.list || 0.0001;
  const NRK = { role: "combo and role", client: "client", session: "session" };
  const srcLine = (o) => (o.clients.join(", ") || "Not recorded") + " · " + (SUBN[o.provider] || o.provider) + " · " + (o.keys.length > 1 ? "keys " : "key ") + o.keys.join(", ");
  const mk = (name, desc, o, extra) => ({ name, desc, v: o.v, real: o.real, req: cnt(o.req), tok: cnt(o.tok), ...(extra || {}) });
  let rowsSrc;
  if (ui.group === "key") rowsSrc = G.key.map((o) => mk(o.k, o.clients.length ? o.clients.join(", ") : "Client not recorded", o));
  else if (ui.group === "model") rowsSrc = G.model.map((o) => mk(o.k, srcLine(o), o));
  else if (ui.group === "role") rowsSrc = G.role.map((o) => mk(o.k, (ROLEDESC[o.k] || "combo") + " · " + (data.roleCount[o.k] || 0) + " sessions", o));
  else if (ui.group === "client") rowsSrc = G.client.map((o) => {
    const tot = o.mix.reduce((a, e) => a + e[1], 0) || 1;
    const mix = o.mix.map(([m, v]) => [m, Math.round((v / tot) * 100)]).filter((e) => e[1] > 0);
    return mk(o.k, (CLIENT_DESC[o.k] || o.k) + " · " + mix.slice(0, 2).map(([m, p]) => short(m) + " " + p + "%").join(", "), o,
      { mix: mix.map(([m, p]) => ({ w: p + "%", c: MC[m] || "#a0958e", t: m + " · " + p + "%" })) });
  });
  else if (ui.group === "session") {
    const top = data.sessions.slice(0, 8);
    rowsSrc = top.map((x) => mk("s·" + x.id, x.client + " · " + x.role + " · " + (x.isToday ? "Today" : x.startDay) + ", " + x.startTime, x));
    if (data.sessionCount > 8) {
      rowsSrc.push(mk("Other sessions", data.sessionCount - 8 + " smaller sessions", data.sessionRest, { other: true }));
    }
  } else rowsSrc = G.provider.map((o) => mk(PROV[o.k] || o.k, SUBN[o.k] ? (o.k in { openrouter: 1, deepseek: 1 } ? "Pay per token" : SUBN[o.k] === "local" ? "Local · free" : "Subscription") : "Provider", o));
  if (["role", "client", "session"].includes(ui.group) && totals.nrReq > 0)
    rowsSrc.push({ name: "Not recorded", desc: "requests before " + loggedLabel, v: totals.nrList, real: 0, req: cnt(totals.nrReq), tok: cnt(totals.nrTok), nr: true });
  rowsSrc.sort((a, b) => (ui.group === "session" ? (a.nr ? 2 : a.other ? 1 : 0) - (b.nr ? 2 : b.other ? 1 : 0) : 0) || b.v - a.v);
  const rows = rowsSrc.map((x) => ({
    name: x.name, desc: x.desc, hasMix: !!x.mix, mix: x.mix || [], req: x.req, tok: x.tok,
    real: x.nr ? "not logged" : x.real >= 0.005 ? usd(x.real, 1) : x.real > 0 ? "<$0.01" : "—", realC: x.real > 0 && !x.nr ? "var(--acc)" : "var(--tx3)",
    value: x.v ? usd(x.v) : "$0.00", share: ((x.v / list) * 100).toFixed(1) + "%", shareL: ((x.v / list) * 100 < 0.1 && x.v > 0 ? "<0.1" : ((x.v / list) * 100).toFixed(1)) + "%",
  }));
  const groups = [["key", "API key"], ["model", "Model"], ["role", "Combo/Role"], ["client", "Client"], ["session", "Session"], ["provider", "Provider"]]
    .map(([k, label]) => ({ label, style: seg(ui.group === k), on: () => set({ group: k }) }));
  const groupHead = { key: "API KEY", model: "MODEL", role: "COMBO / ROLE", client: "CLIENT", session: "SESSION", provider: "PROVIDER" }[ui.group];

  // Agents and sessions
  const LL = Math.max(data.sessionValue, 0.01);
  const sList = (ui.agFilter ? data.sessions.filter((x) => x.id === ui.agFilter) : data.sessions).slice(0, 10);
  const RCo = (r) => RC[r] || RC.scout;
  const sessions = sList.map((x) => {
    const open = ui.agOpen === x.id;
    return {
      id: "s·" + x.id, client: x.client, role: x.role, roleBg: RCo(x.role)[0], roleC: RCo(x.role)[1],
      chips: x.models.slice(0, 3).map((m) => ({ short: short(m.m), full: m.m })), more: x.models.length > 3 ? "+" + (x.models.length - 3) : "",
      moreTip: x.models.slice(3).map((m) => short(m.m)).join(", "), req: x.req.toLocaleString("en-US"), dur: durF(x.end - x.start),
      started: (x.isToday ? "Today" : x.startDay) + ", " + x.startTime, real: realF(x.real), realC: x.real > 0 ? "var(--acc)" : "var(--tx3)", value: usd(x.v),
      share: Math.min(100, (x.v / LL) * 100).toFixed(1) + "%", shareL: ((x.v / LL) * 100).toFixed(1) + "%",
      open, chev: open ? "expand_more" : "chevron_right", bg: open ? "var(--seg)" : "transparent",
      toggle: () => set((u) => ({ agOpen: u.agOpen === x.id ? null : x.id })),
      models: x.models.map((m) => ({ m: short(m.m), prov: PROV[m.provider] || m.provider, req: m.req.toLocaleString("en-US"), v: usd(m.v) + (m.real > 0 ? " · real " + realF(m.real) : "") })),
      ticks: x.ticks.map((t) => ({ l: (Math.min(0.99, t) * 100).toFixed(1) + "%" })),
      tStart: x.startTime + " IST", tEnd: x.endTime + " IST", sumLine: x.req + " requests over " + durF(x.end - x.start) + " · key " + x.key,
    };
  });
  const roleKeys = [...new Set([...ROLE_ORDER.filter((r) => G.role.some((o) => o.k === r)), ...G.role.map((o) => o.k)])];
  const roles = roleKeys.map((role) => {
    const o = G.role.find((x) => x.k === role) || { v: 0, real: 0 }, n = data.roleCount[role] || 0;
    return { role, desc: ROLEDESC[role] || "combo", bg: RCo(role)[0], c: RCo(role)[1], sessions: n.toLocaleString("en-US"), avg: n ? usd(o.v / n) : "—",
      total: usd(o.v), real: realF(o.real), realC: o.real > 0 ? "var(--acc)" : "var(--tx3)", share: ((o.v / LL) * 100).toFixed(1) + "%", shareL: ((o.v / LL) * 100).toFixed(0) + "%" };
  });
  const noSess = data.sessionCount === 0;
  const loggedNote = `Client, session and combo logged since ${loggedLabel}.`;
  const ag = {
    sub: ui.agView === "sessions" ? "Top 10 sessions in range by list-price value · click a row for models and timeline" : "One row per agent role · " + data.sessionCount + " sessions in range · roles map 1:1 to combos; main = single model",
    views: [["sessions", "Sessions"], ["roles", "Roles"]].map(([k, label]) => ({ label, style: seg(ui.agView === k), on: () => set({ agView: k }) })),
    filter: ui.agFilter ? "s·" + ui.agFilter : "", clearFilter: () => set({ agFilter: null, agOpen: null }),
    loading: false, error: false, empty: noSess, emptyTitle: "Session data starts " + loggedLabel,
    emptyText: anyLogged ? "No sessions in this range yet. Client, session and combo are logged for every request from " + loggedLabel + "." : "This range is before " + loggedLabel + ". Client, session and combo were not logged then, so requests count in Breakdown under “Not recorded”.",
    errorText: "", showSessions: !noSess && ui.agView === "sessions", showRoles: !noSess && ui.agView === "roles", sessions, roles,
    skel: [120, 180, 150, 200, 130].map((w) => ({ w: w + "px" })), retry: () => {},
    note: noSess ? loggedNote : (allLogged ? loggedNote : loggedNote + " Earlier requests are not in this panel.") + " Role totals are the sum of all " + data.sessionCount + " sessions in range (" + usd(data.sessionValue) + "). Real spend comes from OpenRouter and DeepSeek fallbacks.",
  };

  // Outliers
  const CL = { "Claude Code": "Claude Code" };
  const outl = (ui.rank === "real" ? data.outliers.real : data.outliers.value).map((o, i) => ({
    rank: i + 1, when: o.when, model: short(o.model), modelFull: o.model, key: o.key, combo: o.combo, wide: !fit.oNarrow, narrow: !!fit.oNarrow,
    client: o.client ? CL[o.client] || o.client : "n/a", sess: o.sess ? "s·" + o.sess : "", hasSess: !!o.sess, noSess: !o.sess,
    goSess: () => { set({ agFilter: o.sess, agView: "sessions", agOpen: o.sess, scrollTick: Date.now() }); },
    tok: cnt(o.tok), value: usd(o.v), real: o.real ? usd(o.real, 1) + (o.est ? "*" : "") : "—", realTip: o.est ? "Estimated from list price. The provider did not report a cost." : "",
    realC: o.real ? "var(--acc)" : "var(--tx3)", flag: false,
  }));
  const rankBtns = [["value", "By list price"], ["real", "By real spend"]].map(([k, label]) => ({ label, style: seg(ui.rank === k), on: () => set({ rank: k }) }));
  const tdMax = data.topBars[0]?.tot || 1;
  const topDays = data.topBars.map((b) => ({
    label: b.label, value: usd(b.val), real: usd(b.real, 1), w: (b.tot / tdMax) * 100 + "%",
    top: b.top ? b.top.key + " · " + b.top.role + " · s·" + b.top.id + (b.top.realVia.length ? " · real via " + b.top.realVia.join(", ") : "") : (b.topKey || "—") + " · sessions not recorded",
  }));

  return {
    rangeTitle, rangeSub,
    k: { realSrc: totals.realEst > 0.005 ? "PARTLY ESTIMATED" : "FROM PROVIDER", realEstTip: totals.realEst > 0.005 ? `${usd(totals.realEst, 1)} is estimated from list price: the provider did not report a cost for those calls.` : "", real: usd(totals.real, 1), or: usd(totals.realOr, 1), ds: usd(totals.realDs, 1), value: usd(totals.value), ratio: ratio ? ratio.toFixed(1) + "×" : "—",
      ratioSub: usd(valueFeed) + " value ÷ " + usd(feesPro) + " fees for " + dayCount + (dayCount === 1 ? " day" : " days") + (unset.length ? ". Excludes " + unset.join(", ") + " (no fee set)." : ""),
      feesPro: usd(feesPro) },
    or, ds, trend, chart, readout, allowance, subs, dayCount,
    editing: ui.editing, notEditing: !ui.editing,
    startEdit: () => set({ editing: true, draft: { ...fees } }), cancelEdit: () => set({ editing: false, draft: null }), saveEdit: saveFees,
    groups, groupHead, rows, rankBtns, outliers: outl, noOutliers: outl.length === 0, topDays, topDaysTitle: hourly ? "TOP 5 HOURS" : "TOP 5 DAYS", ag,
    aWpx: Math.max(260, fit.aW - 44) + "px", detCols: fit.aW < 640 ? "minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1fr)",
    maskA: fit.fadeA ? "linear-gradient(to right,#000 calc(100% - 40px),transparent)" : "none", maskR: fit.fadeR ? "linear-gradient(to right,#000 calc(100% - 40px),transparent)" : "none",
    bdNote: allLogged || !NRK[ui.group] ? `Client, session and combo logged since ${loggedLabel}.` : `Client, session and combo logged since ${loggedLabel}. Earlier requests fall under “Not recorded”.`,
    outNote: ui.rank === "real" ? "Requests with real spend in range, highest first." : "Time (IST) · model · key and role · client · session · tokens · list-price value · real spend. Real spend only on OpenRouter and DeepSeek.",
    loggedNote: "Real spend from OpenRouter and DeepSeek request costs", nrTip: "Session not recorded before " + loggedLabel,
    skel: [40, 62, 55, 70, 48, 80, 66, 52, 74, 58, 45, 68, 60, 77, 50, 64, 72, 56, 61, 70].map((h) => ({ h: h + "%" })),
  };
}
