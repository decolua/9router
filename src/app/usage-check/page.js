"use client";

import { useState, useEffect, useRef } from "react";
import {
  Card,
  Button,
  Input,
  Modal,
  SegmentedControl,
} from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

function fmt(n) {
  return (Number(n) || 0).toLocaleString();
}

const fmtCompact = (n) => {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
};

const WINDOW_LABEL = {
  total: "Total (lifetime)",
  daily: "Daily",
  monthly: "Monthly",
};

const PERIODS = [
  { value: "", label: "Auto" },
  { value: "today", label: "Today" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "all", label: "All" },
];

const SORTS = [
  { value: "tokens", label: "Tokens" },
  { value: "requests", label: "Requests" },
  { value: "name", label: "Name" },
];

// Reverse index: provider alias/uiAlias → provider id (untuk ikon /providers/{id}.png).
const ALIAS_TO_ID = (() => {
  const map = {};
  for (const [id, p] of Object.entries(AI_PROVIDERS || {})) {
    map[id] = id;
    if (p.alias) map[p.alias] = id;
    if (p.uiAlias) map[p.uiAlias] = id;
  }
  return map;
})();

function providerIdFromModel(modelStr) {
  if (!modelStr) return "";
  const i = String(modelStr).indexOf("/");
  if (i < 0) return "";
  const prefix = String(modelStr).slice(0, i);
  return ALIAS_TO_ID[prefix] || prefix;
}

function providerIdFromField(provider) {
  if (!provider) return "";
  return ALIAS_TO_ID[provider] || provider;
}

function maskKey(k) {
  if (!k) return "";
  if (k.length <= 12) return k;
  return `${k.slice(0, 8)}…${k.slice(-4)}`;
}

export default function UsageCheckPage() {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [lastName, setLastName] = useState("");
  const [period, setPeriod] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    try {
      setOrigin(window.location.origin);
    } catch {}
    try {
      const savedName = sessionStorage.getItem("9r_usage_name");
      const savedPwd = sessionStorage.getItem("9r_usage_pwd");
      const savedPeriod = sessionStorage.getItem("9r_usage_period") || "";
      if (savedName && savedPwd) {
        setName(savedName);
        setPassword(savedPwd);
        setPeriod(savedPeriod);
        runLookup(savedName, savedPeriod, savedPwd);
      }
    } catch {}
  }, []);

  const runLookup = async (q, p, pwd) => {
    if (!q) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/public/key-usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: q,
          password: pwd,
          period: p || undefined,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setData(json);
        setLastName(q);
        try {
          sessionStorage.setItem("9r_usage_name", q);
          sessionStorage.setItem("9r_usage_pwd", pwd);
          sessionStorage.setItem("9r_usage_period", p || "");
        } catch {}
      } else {
        setError(json.error || "Lookup failed");
        setData(null);
        if (res.status === 401 || res.status === 403) {
          try {
            sessionStorage.removeItem("9r_usage_name");
            sessionStorage.removeItem("9r_usage_pwd");
            sessionStorage.removeItem("9r_usage_period");
          } catch {}
        }
      }
    } catch {
      setError("An error occurred. Please try again.");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e) => {
    e?.preventDefault();
    const q = name.trim();
    if (!q || !password) return;
    runLookup(q, period, password);
  };

  const onPeriodChange = (p) => {
    setPeriod(p);
    try {
      sessionStorage.setItem("9r_usage_period", p || "");
    } catch {}
    if (lastName) runLookup(lastName, p, password);
  };

  const resetLookup = () => {
    setData(null);
    setError("");
    setName("");
    setPassword("");
    setPeriod("");
    try {
      sessionStorage.removeItem("9r_usage_name");
      sessionStorage.removeItem("9r_usage_pwd");
      sessionStorage.removeItem("9r_usage_period");
    } catch {}
  };

  const inDetail = data && data.count > 0;

  return (
    <div className="min-h-screen flex items-start justify-center bg-bg p-4 relative overflow-hidden">
      <div
        className="landing-grid absolute inset-0 pointer-events-none"
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-3xl mt-8 sm:mt-12">
        {!inDetail ? (
          <>
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-500/10 text-brand-500 mb-3">
                <span className="material-symbols-outlined text-3xl">
                  token
                </span>
              </div>
              <h1 className="text-3xl font-bold text-primary mb-2">
                Token Usage
              </h1>
              <p className="text-text-muted">
                Enter an API key name and the lookup password to view usage.
              </p>
            </div>
            <Card>
              <form onSubmit={onSubmit} className="flex flex-col gap-3">
                <Input
                  placeholder="API key name, e.g. yudha"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder="Lookup password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    loading={loading}
                    disabled={!name.trim() || !password}
                  >
                    Check
                  </Button>
                </div>
                {error && <p className="text-xs text-red-500">{error}</p>}
              </form>
            </Card>

            {data && data.count === 0 && (
              <Card className="mt-4">
                <p className="text-sm text-text-muted text-center">
                  No API key found with the name &quot;{data.name}&quot;.
                </p>
              </Card>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-5">
            {/* Detail header */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="shrink-0 w-11 h-11 rounded-xl bg-brand-500/10 text-brand-500 flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl">
                    vpn_key
                  </span>
                </div>
                <div className="min-w-0">
                  <h1 className="text-xl font-bold text-primary truncate">
                    {data.name}
                  </h1>
                  <p className="text-xs text-text-muted">
                    {data.count} key(s) found
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon="search"
                onClick={resetLookup}
              >
                New lookup
              </Button>
            </div>

            {/* Period filter */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-text-muted">
                Period
              </label>
              <SegmentedControl
                options={PERIODS}
                value={period}
                onChange={onPeriodChange}
                size="sm"
                className="w-full sm:w-auto"
              />
            </div>

            <div className="flex flex-col gap-4">
              {loading
                ? Array.from({ length: data.results.length || 1 }).map(
                    (_, i) => <SkeletonCard key={i} />,
                  )
                : data.results.map((r, i) => (
                    <KeyCard
                      key={i}
                      r={r}
                      origin={origin}
                      period={period}
                      aliases={data.aliases || {}}
                      excludedProviders={data.excludedProviders || []}
                    />
                  ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function copyText(value) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(value);
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.setAttribute("readonly", "");
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return Promise.resolve();
  } catch (e) {
    return Promise.reject(e);
  }
}

function CopyBtn({ value, title = "Copy" }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await copyText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <button
      onClick={copy}
      className="p-1 rounded text-text-muted hover:text-primary"
      title={title}
      type="button"
    >
      <span className="material-symbols-outlined text-[15px]">
        {copied ? "check" : "content_copy"}
      </span>
    </button>
  );
}

// Animasi count-up sederhana untuk angka di Stat card.
function useCountUp(target, duration = 700) {
  const [val, setVal] = useState(0);
  const startRef = useRef(null);
  const fromRef = useRef(0);
  const rafRef = useRef(null);

  useEffect(() => {
    const dest = Number(target) || 0;
    fromRef.current = val;
    startRef.current = null;
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const tick = (ts) => {
      if (!startRef.current) startRef.current = ts;
      const p = Math.min(1, (ts - startRef.current) / duration);
      const eased = easeOut(p);
      setVal(Math.round(fromRef.current + (dest - fromRef.current) * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => rafRef.current && cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);
  return val;
}

function Stat({ label, value, rawValue, sub, danger, accent, icon }) {
  const numeric = typeof rawValue === "number" ? rawValue : 0;
  const animated = useCountUp(numeric);
  const display =
    rawValue === null || rawValue === undefined ? value : fmtCompact(animated);

  const accentColor = danger
    ? "text-red-500"
    : accent === "primary"
      ? "text-primary"
      : accent === "success"
        ? "text-success"
        : accent === "warning"
          ? "text-warning"
          : "";
  const ringColor = danger
    ? "bg-red-500/10 text-red-500"
    : accent === "primary"
      ? "bg-brand-500/10 text-brand-500"
      : accent === "success"
        ? "bg-green-500/10 text-success"
        : "bg-surface-2 text-text-muted";
  return (
    <Card className="group relative flex min-w-0 flex-col gap-1.5 px-4 py-3 overflow-hidden hover:border-brand-500/30 transition-all">
      <div className="flex items-center justify-between gap-2">
        <span className="text-text-muted text-[10px] uppercase font-semibold tracking-wider truncate">
          {label}
        </span>
        {icon && (
          <span
            className={`shrink-0 w-6 h-6 rounded-md flex items-center justify-center ${ringColor}`}
          >
            <span className="material-symbols-outlined text-[14px]">
              {icon}
            </span>
          </span>
        )}
      </div>
      <span
        className={`truncate text-2xl font-bold tabular-nums ${accentColor}`}
      >
        {display}
      </span>
      {sub && (
        <span className="text-[10px] text-text-muted truncate">{sub}</span>
      )}
    </Card>
  );
}

function MiniChart({ data, loading }) {
  if (loading) {
    return <div className="h-20 rounded-lg bg-surface-2 animate-pulse" />;
  }
  const hasData = (data || []).some((d) => (d.tokens || 0) > 0);
  if (!hasData) {
    return (
      <div className="h-20 rounded-lg border border-dashed border-border-subtle flex items-center justify-center text-[11px] text-text-muted">
        No activity in the last 14 days
      </div>
    );
  }
  return (
    <div className="h-20 -mx-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 6, right: 4, left: 4, bottom: 0 }}
        >
          <defs>
            <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="label" hide />
          <YAxis hide />
          <Tooltip
            cursor={{ stroke: "#6366f1", strokeOpacity: 0.3, strokeWidth: 1 }}
            contentStyle={{
              backgroundColor: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: "8px",
              fontSize: "11px",
              padding: "4px 8px",
            }}
            formatter={(v, n) => [fmtCompact(v), n === "tokens" ? "Tokens" : n]}
            labelStyle={{ color: "var(--color-text-muted)", fontSize: "10px" }}
          />
          <Area
            type="monotone"
            dataKey="tokens"
            stroke="#6366f1"
            strokeWidth={2}
            fill="url(#sparkGrad)"
            dot={false}
            activeDot={{ r: 3 }}
            isAnimationActive
            animationDuration={600}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function SkeletonCard() {
  return (
    <Card className="flex flex-col gap-4 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="h-4 w-24 rounded bg-surface-2" />
        <div className="h-3 w-12 rounded bg-surface-2" />
      </div>
      <div className="h-9 rounded-lg bg-surface-2" />
      <div className="h-9 rounded-lg bg-surface-2" />
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-surface-2" />
        ))}
      </div>
      <div className="h-20 rounded-lg bg-surface-2" />
    </Card>
  );
}

function CodeBlock({ code, label }) {
  return (
    <div className="relative">
      {label && <p className="text-[11px] text-text-muted mb-1">{label}</p>}
      <div className="relative bg-bg border border-border-subtle rounded-lg">
        <pre className="text-[11px] leading-relaxed p-3 pr-9 overflow-x-auto">
          <code>{code}</code>
        </pre>
        <div className="absolute top-1.5 right-1.5">
          <CopyBtn value={code} title="Copy" />
        </div>
      </div>
    </div>
  );
}

function ModelIcon({ model, provider, size = 22 }) {
  const id = providerIdFromField(provider) || providerIdFromModel(model);
  return (
    <ProviderIcon
      src={id ? `/providers/${id}.png` : undefined}
      alt={provider || model || ""}
      size={size}
      className="rounded-md shrink-0 bg-surface-2"
      fallbackText={(model || "?").slice(0, 2).toUpperCase()}
    />
  );
}

function KeyCard({ r, origin, period, aliases = {}, excludedProviders = [] }) {
  const [showKey, setShowKey] = useState(false);
  const [availModels, setAvailModels] = useState(null);
  const [showModelsModal, setShowModelsModal] = useState(false);
  const [availFilter, setAvailFilter] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [sortBy, setSortBy] = useState("tokens");
  const [showDocs, setShowDocs] = useState(false);

  const v1Url = origin ? `${origin}/v1` : "/v1";
  const restricted =
    Array.isArray(r.allowedModels) && r.allowedModels.length > 0;

  const bareId = (s) => {
    const str = String(s);
    const i = str.indexOf("/");
    return i >= 0 ? str.slice(i + 1) : str;
  };
  const aliasesByTarget = (() => {
    const map = {};
    for (const [aliasName, target] of Object.entries(aliases || {})) {
      const t = String(target);
      (map[t] ||= []).push(aliasName);
      const b = bareId(t);
      if (b !== t) (map[`bare:${b}`] ||= []).push(aliasName);
    }
    return map;
  })();
  const aliasesFor = (m) => {
    const set = new Set([
      ...(aliasesByTarget[m] || []),
      ...(aliasesByTarget[`bare:${bareId(m)}`] || []),
    ]);
    return [...set];
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (restricted) {
        setAvailModels(r.allowedModels);
        return;
      }
      if (!r.key) {
        setAvailModels([]);
        return;
      }
      try {
        const res = await fetch(`${origin}/v1/models`, {
          headers: { Authorization: `Bearer ${r.key}` },
        });
        const json = await res.json();
        const list = (json?.data || json?.models || [])
          .map((m) => m.id || m.name)
          .filter(Boolean);
        if (!cancelled) setAvailModels(list);
      } catch {
        if (!cancelled) setAvailModels([]);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [r, origin, restricted]);

  const breakdownTotal =
    period && period !== ""
      ? r.usedPeriod
      : (r.usedWindowActual ?? r.usedWindow);
  const rangeLabel = r.period
    ? PERIODS.find((p) => p.value === r.period)?.label || r.period
    : WINDOW_LABEL[r.limitWindow] || r.limitWindow;

  const models = (() => {
    const filtered = (r.models || []).filter((m) => {
      const q = modelFilter.toLowerCase();
      return (
        !q ||
        m.model.toLowerCase().includes(q) ||
        (m.provider || "").toLowerCase().includes(q)
      );
    });
    const sorted = [...filtered];
    if (sortBy === "tokens")
      sorted.sort((a, b) => b.totalTokens - a.totalTokens);
    else if (sortBy === "requests")
      sorted.sort((a, b) => b.requests - a.requests);
    else sorted.sort((a, b) => a.model.localeCompare(b.model));
    return sorted;
  })();

  const filteredAvail = (availModels || []).filter((m) => {
    if (!availFilter) return true;
    const q = availFilter.toLowerCase();
    if (m.toLowerCase().includes(q)) return true;
    return aliasesFor(m).some((a) => a.toLowerCase().includes(q));
  });

  const docModel =
    (restricted && r.allowedModels[0]) ||
    (Array.isArray(availModels) && availModels[0]) ||
    "cc/claude-opus-4.7";

  const availEntries = (() => {
    const out = [];
    for (const m of filteredAvail) {
      const al = aliasesFor(m);
      if (al.length > 0) {
        for (const a of al) out.push({ display: a, model: m, isAlias: true });
      } else {
        out.push({ display: m, model: m, isAlias: false });
      }
    }
    return out;
  })();
  const copyAllValue = availEntries.map((e) => e.display).join("\n");

  const totalRequests = (r.models || []).reduce(
    (s, m) => s + (Number(m.requests) || 0),
    0,
  );
  const maxTokens =
    models.length > 0 ? Math.max(...models.map((m) => m.totalTokens || 0)) : 0;
  const usagePct =
    r.tokenLimit > 0
      ? Math.min(100, Math.round((breakdownTotal / r.tokenLimit) * 100))
      : 0;

  return (
    <Card padding="md" className="flex flex-col gap-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold truncate">{r.name}</span>
          {!r.isActive && (
            <span className="text-[11px] text-orange-500 border border-orange-500/40 rounded-full px-2 py-0.5">
              Paused
            </span>
          )}
        </div>
        {r.tokenLimit > 0 && r.exceeded && (
          <span className="text-[11px] text-red-500 font-medium flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">error</span>
            Limit reached
          </span>
        )}
      </div>

      {/* Connection info */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 bg-surface-2 rounded-[10px] px-3 py-2">
          <span className="text-[11px] text-text-muted w-16 shrink-0">
            Base URL
          </span>
          <code className="text-xs flex-1 truncate">{v1Url}</code>
          <CopyBtn value={v1Url} title="Copy URL" />
        </div>
        {r.key && (
          <div className="flex items-center gap-2 bg-surface-2 rounded-[10px] px-3 py-2">
            <span className="text-[11px] text-text-muted w-16 shrink-0">
              API key
            </span>
            <code className="text-xs flex-1 truncate font-mono">
              {showKey ? r.key : maskKey(r.key)}
            </code>
            <button
              onClick={() => setShowKey((s) => !s)}
              className="p-1 rounded text-text-muted hover:text-primary"
              title={showKey ? "Hide" : "Show"}
              type="button"
            >
              <span className="material-symbols-outlined text-[15px]">
                {showKey ? "visibility_off" : "visibility"}
              </span>
            </button>
            <CopyBtn value={r.key} title="Copy API key" />
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowModelsModal(true)}
          className="flex items-center justify-between gap-2 bg-surface-2 rounded-[10px] px-3 py-2 hover:border-brand-500/30 border border-transparent transition-all"
        >
          <span className="text-[11px] text-text-muted flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px]">
              grid_view
            </span>
            Available models
          </span>
          <span className="flex items-center gap-1 text-xs text-text-main">
            {availModels === null
              ? "…"
              : `${availEntries.length}${restricted ? " (restricted)" : ""}`}
            <span className="material-symbols-outlined text-[16px] text-text-muted">
              chevron_right
            </span>
          </span>
        </button>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat
          label={`Used (${rangeLabel})`}
          rawValue={breakdownTotal}
          sub={fmt(breakdownTotal)}
          accent="primary"
          icon="bolt"
        />
        <Stat
          label="Limit"
          value={r.tokenLimit > 0 ? fmtCompact(r.tokenLimit) : "—"}
          rawValue={r.tokenLimit > 0 ? r.tokenLimit : null}
          sub={r.tokenLimit > 0 ? fmt(r.tokenLimit) : "No limit set"}
          danger={r.tokenLimit > 0 && r.exceeded}
          icon="speed"
        />
        <Stat
          label="Remaining"
          value={r.tokenLimit > 0 ? fmtCompact(r.remaining) : "—"}
          rawValue={r.tokenLimit > 0 ? r.remaining : null}
          sub={r.tokenLimit > 0 ? fmt(r.remaining) : "—"}
          accent="success"
          icon="savings"
        />
        <Stat
          label="All-time"
          rawValue={r.usedTotal}
          sub={fmt(r.usedTotal)}
          icon="history"
        />
      </div>

      {/* Mini trend chart (14 days) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-medium text-text-muted flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">
              trending_up
            </span>
            14-day trend
          </span>
          {(r.chart || []).length > 0 && (
            <span className="text-[11px] text-text-muted tabular-nums">
              {fmtCompact(
                (r.chart || []).reduce((s, d) => s + (d.tokens || 0), 0),
              )}{" "}
              tokens
            </span>
          )}
        </div>
        <MiniChart data={r.chart || []} />
      </div>

      {/* Usage progress bar */}
      {r.tokenLimit > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-text-muted">Quota usage ({rangeLabel})</span>
            <span
              className={
                r.exceeded
                  ? "text-red-500 font-medium"
                  : "text-text-main font-medium"
              }
            >
              {usagePct}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${r.exceeded ? "bg-red-500" : usagePct >= 85 ? "bg-warning" : "bg-brand-500"}`}
              style={{ width: `${usagePct}%` }}
            />
          </div>
          {excludedProviders.length > 0 && (
            <p className="text-[11px] text-text-muted mt-0.5">
              Not counted (excluded):{" "}
              {excludedProviders
                .map((e) => (typeof e === "string" ? e : e.name))
                .join(", ")}
            </p>
          )}
        </div>
      )}

      {/* API usage docs */}
      <div className="border-t border-black/[0.06] dark:border-white/[0.06] pt-3">
        <button
          type="button"
          onClick={() => setShowDocs((s) => !s)}
          className="w-full flex items-center justify-between text-xs font-medium text-text-muted hover:text-text-main"
        >
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[15px]">
              terminal
            </span>
            API usage example (curl)
          </span>
          <span className="material-symbols-outlined text-[18px]">
            {showDocs ? "expand_less" : "expand_more"}
          </span>
        </button>
        {showDocs && (
          <div className="mt-2 flex flex-col gap-3">
            <CodeBlock
              label="Chat completion"
              code={`curl ${v1Url}/chat/completions \\
  -H "Authorization: Bearer ${r.key || "YOUR_API_KEY"}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${docModel}",
    "messages": [{ "role": "user", "content": "Hello!" }]
  }'`}
            />
            <CodeBlock
              label="List available models"
              code={`curl ${v1Url}/models \\
  -H "Authorization: Bearer ${r.key || "YOUR_API_KEY"}"`}
            />
            <p className="text-[11px] text-text-muted">
              Base URL: <code>{v1Url}</code>
              {r.key ? (
                <>
                  {" "}
                  · API key: <code>{maskKey(r.key)}</code>
                </>
              ) : null}
              {restricted
                ? " · This key is restricted to its allowed models."
                : ""}
            </p>
          </div>
        )}
      </div>

      {/* Per-model usage breakdown */}
      <div className="border-t border-black/[0.06] dark:border-white/[0.06] pt-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-text-muted">
            Models used ({rangeLabel})
          </p>
          <div className="flex items-center gap-1.5">
            {SORTS.map((s) => (
              <button
                key={s.value}
                onClick={() => setSortBy(s.value)}
                className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                  sortBy === s.value
                    ? "bg-surface-2 text-text-main border-border"
                    : "border-transparent text-text-muted hover:text-text-main"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <Input
          placeholder="Filter used models..."
          value={modelFilter}
          onChange={(e) => setModelFilter(e.target.value)}
          icon="filter_list"
          inputClassName="text-xs"
        />
        {models.length === 0 ? (
          <div className="mt-2 flex flex-col items-center justify-center py-6 text-center">
            <span className="material-symbols-outlined text-2xl text-text-muted/50 mb-1">
              inbox
            </span>
            <p className="text-xs text-text-muted">
              No usage recorded in this range.
            </p>
          </div>
        ) : (
          <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-border-subtle divide-y divide-border-subtle/60">
            {models.map((m, j) => {
              const pct =
                maxTokens > 0
                  ? Math.round(((m.totalTokens || 0) / maxTokens) * 100)
                  : 0;
              return (
                <div
                  key={j}
                  className="relative px-3 py-2.5 hover:bg-surface-2/50 transition-colors"
                >
                  {/* relative bar background */}
                  <div
                    className="absolute inset-y-0 left-0 bg-brand-500/5 pointer-events-none"
                    style={{ width: `${pct}%` }}
                  />
                  <div className="relative flex items-center gap-3">
                    <ModelIcon model={m.model} provider={m.provider} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">
                        {m.model}
                      </div>
                      {m.provider && (
                        <div className="text-[11px] text-text-muted truncate">
                          {m.provider}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] shrink-0">
                      <div className="text-right">
                        <div className="text-text-muted">In / Out</div>
                        <div className="text-text-main tabular-nums">
                          {fmtCompact(m.promptTokens)} /{" "}
                          {fmtCompact(m.completionTokens)}
                        </div>
                      </div>
                      <div className="text-right w-16">
                        <div className="text-text-muted">Total</div>
                        <div className="font-semibold tabular-nums">
                          {fmt(m.totalTokens)}
                        </div>
                      </div>
                      <div className="text-right w-12">
                        <div className="text-text-muted">Req</div>
                        <div className="text-text-main tabular-nums">
                          {fmt(m.requests)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {models.length > 0 && (
          <p className="text-[11px] text-text-muted mt-1.5">
            {models.length} model(s) · {fmt(totalRequests)} request(s)
          </p>
        )}
      </div>

      {/* Available models dialog */}
      <Modal
        isOpen={showModelsModal}
        title={`Available models${restricted ? " (restricted)" : ""} · ${r.name}`}
        onClose={() => setShowModelsModal(false)}
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Filter models..."
              value={availFilter}
              onChange={(e) => setAvailFilter(e.target.value)}
              icon="search"
              className="flex-1"
            />
            {availEntries.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                icon="content_copy"
                onClick={() => copyText(copyAllValue)}
              >
                Copy all
              </Button>
            )}
          </div>
          {availModels === null ? (
            <p className="text-sm text-text-muted py-4 text-center">
              Loading models…
            </p>
          ) : availEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <span className="material-symbols-outlined text-2xl text-text-muted/50 mb-1">
                search_off
              </span>
              <p className="text-sm text-text-muted">
                No models{availFilter ? " match the filter" : " available"}.
              </p>
            </div>
          ) : (
            <div className="max-h-[55vh] overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {availEntries.map((e, idx) => (
                <div
                  key={`${e.display}-${idx}`}
                  className="group flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-transparent hover:border-border hover:bg-surface-2 transition-all"
                >
                  <ModelIcon model={e.model} size={24} />
                  <div className="flex-1 min-w-0">
                    <code className="text-xs block truncate font-medium">
                      {e.display}
                    </code>
                    {e.isAlias && (
                      <div className="text-[10px] text-text-muted truncate">
                        → {e.model}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => copyText(e.display)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-text-muted hover:text-primary transition-opacity"
                    title="Copy model"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[15px]">
                      content_copy
                    </span>
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-text-muted">
            {availEntries.length} model(s)
          </p>
        </div>
      </Modal>
    </Card>
  );
}
