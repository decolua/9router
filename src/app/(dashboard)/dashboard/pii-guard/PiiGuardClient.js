"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, Button, SegmentedControl, Select, Badge } from "@/shared/components";

const MODES = [
  { value: "off", label: "Off" },
  { value: "observe", label: "Observe" },
  { value: "redact", label: "Redact" },
  { value: "block", label: "Block" },
];

const MODE_HELP = {
  off: "No scan. Requests pass unchanged.",
  observe: "Scan and log findings. Requests pass unchanged.",
  redact: "Rewrites every editable field (user, assistant history, tool calls/results, system) with placeholders such as {{pii:pan#ab12cd}}.",
  block: "Rejects a request the first time a new value appears (HTTP 400). Retries redact it.",
};

const ACTION_BADGE_VARIANT = {
  block: "error",
  leaked: "error",
  redact: "warning",
  observe: "info",
  ignored: "default",
};

const KIND_CONFIG = {
  secret: { bar: "bg-red-500", badge: "error" },
  pii: { bar: "bg-brand-500", badge: "info" },
  known: { bar: "bg-emerald-500", badge: "success" },
};

const count = value => Number(value || 0).toLocaleString();

const age = value => {
  if (!value) return "unknown";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
};

function humanizeSource(source) {
  if (!source || source === "-") return "other";
  const parts = source.split("/");
  if (parts.length === 2) {
    const role = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    const type = parts[1].replace(/_/g, " ");
    return `${role} · ${type}`;
  }
  return source.replace(/_/g, " ");
}

async function call(body) {
  const res = await fetch("/api/pii-guard", {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export default function PiiGuardClient() {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("My mobile number is {{pii:in_phone#da6f85}} and PAN is ABCPE1234F.");
  const [result, setResult] = useState(null);
  const [testMode, setTestMode] = useState("current");
  const [showIgnored, setShowIgnored] = useState(false);
  const [ruleFilter, setRuleFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  // ponytail: max 100 findings and client-side bar scaling; paginate when findings exceed 1000
  const [showAllRows, setShowAllRows] = useState(false);

  const load = useCallback(() => call().then(setState).catch(e => setError(e.message)), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  const save = patch => call(patch).then(s => { setState(s); setError(""); }).catch(e => setError(e.message));
  const confirmBlock = mode => mode !== "block" || window.confirm("Block stops the first request that contains a new value. Later requests redact it. Continue?");
  const chooseMode = mode => { if (confirmBlock(mode)) save({ mode }); };
  const runTest = () => call({ test: text, testMode }).then(r => { setResult(r); setError(""); }).catch(e => setError(e.message));

  const rulesMap = useMemo(() => {
    const map = new Map();
    (state?.rules || []).forEach(r => map.set(r.id, r));
    return map;
  }, [state?.rules]);

  const sortedRules = useMemo(() => {
    const entries = Object.entries(state?.summary?.byRule || {});
    return entries
      .map(([rule, val]) => ({
        rule,
        unique: val?.unique || 0,
        hits: val?.hits || 0,
        kind: rulesMap.get(rule)?.kind || "pii",
      }))
      .sort((a, b) => b.hits - a.hits || b.unique - a.unique);
  }, [state?.summary?.byRule, rulesMap]);

  const maxRuleHits = useMemo(() => {
    return Math.max(...sortedRules.map(r => r.hits), 1);
  }, [sortedRules]);

  const sortedSources = useMemo(() => {
    const entries = Object.entries(state?.summary?.bySource || {});
    return entries
      .map(([source, hits]) => ({
        source,
        label: humanizeSource(source),
        hits: Number(hits || 0),
      }))
      .sort((a, b) => b.hits - a.hits);
  }, [state?.summary?.bySource]);

  const maxSourceHits = useMemo(() => {
    return Math.max(...sortedSources.map(s => s.hits), 1);
  }, [sortedSources]);

  const availableRules = useMemo(() => {
    const set = new Set();
    (state?.summary?.groups || []).forEach(g => {
      if (g.rule) set.add(g.rule);
    });
    return Array.from(set).sort();
  }, [state?.summary?.groups]);

  const ruleFilterOptions = useMemo(() => [
    { value: "all", label: "All rules" },
    ...availableRules.map(r => ({ value: r, label: r })),
  ], [availableRules]);

  const filteredGroups = useMemo(() => {
    const list = (state?.summary?.groups || []).filter(group => showIgnored || !group.ignored);
    const q = searchQuery.trim().toLowerCase();
    return list.filter(g => {
      if (ruleFilter !== "all" && g.rule !== ruleFilter) return false;
      if (q) {
        const matchRule = (g.rule || "").toLowerCase().includes(q);
        const matchName = (g.name || "").toLowerCase().includes(q);
        const matchHash = (g.hash || "").toLowerCase().includes(q);
        if (!matchRule && !matchName && !matchHash) return false;
      }
      return true;
    });
  }, [state?.summary?.groups, showIgnored, ruleFilter, searchQuery]);

  if (!state) return <div className="p-6 text-text-muted">{error || "Loading..."}</div>;

  const {
    config = { mode: "observe", rules: {}, ignore: [] },
    rules = [],
    recent = [],
    summary = {},
    health = null,
    enabled,
    available,
  } = state;

  const knownUpdated = health?.knownUpdated;
  const displayedGroups = showAllRows ? filteredGroups : filteredGroups.slice(0, 100);

  return (
    <div className="space-y-6 p-6">
      {error && <div className="text-sm text-red-500" role="alert">{error}</div>}
      {!enabled && (
        <Card>
          <p className="text-sm">PII_GUARD_MODULE is not set. Set it in the service drop-in and restart 9Router.</p>
        </Card>
      )}
      {enabled && !available && (
        <Card>
          <p className="text-sm text-red-500">Scanner did not load. Check the console log for [pii-guard] lines.</p>
        </Card>
      )}

      {/* Mode Card */}
      <Card>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold flex items-center gap-2 text-text-main">
              <span className="material-symbols-outlined text-primary">shield_person</span>
              PII Guard
            </h2>
            <p className="text-xs text-text-muted mt-1">{MODE_HELP[config.mode]}</p>
          </div>
          <SegmentedControl options={MODES} value={config.mode} onChange={mode => chooseMode(mode)} />
        </div>
        <p className="text-xs text-text-muted mt-3 pt-3 border-t border-border-subtle">
          Values the scanner cannot rewrite (signed thinking, object keys, numbers) are reported as leaked. A scanner error never blocks a request.
        </p>
      </Card>

      {/* KPI Tiles Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="flex flex-col justify-between p-4">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider">Unique values</span>
            <span className={`material-symbols-outlined text-[20px] ${summary.unique24h ? "text-brand-500" : ""}`}>
              fingerprint
            </span>
          </div>
          <div className="mt-3">
            <span className={`text-2xl font-bold tracking-tight ${summary.unique24h ? "text-text-main" : "text-text-muted"}`}>
              {count(summary.unique24h)}
            </span>
            <span className="block text-xs text-text-muted mt-0.5">Last 24 hours</span>
          </div>
        </Card>

        <Card className="flex flex-col justify-between p-4">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider">Leaked through</span>
            <span className={`material-symbols-outlined text-[20px] ${summary.leaked24h ? "text-red-500" : ""}`}>
              warning
            </span>
          </div>
          <div className="mt-3">
            <span className={`text-2xl font-bold tracking-tight ${summary.leaked24h ? "text-red-500 dark:text-red-400" : "text-text-muted"}`}>
              {count(summary.leaked24h)}
            </span>
            <p className="mt-1 text-[11px] leading-tight text-text-muted">
              Seen but could not be rewritten (signed thinking, object keys, numbers). Set the rule to Block to stop these.
            </p>
          </div>
        </Card>

        <Card className="flex flex-col justify-between p-4">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider">Blocked</span>
            <span className={`material-symbols-outlined text-[20px] ${summary.blocked24h ? "text-amber-500" : ""}`}>
              block
            </span>
          </div>
          <div className="mt-3">
            <span className={`text-2xl font-bold tracking-tight ${summary.blocked24h ? "text-amber-500 dark:text-amber-400" : "text-text-muted"}`}>
              {count(summary.blocked24h)}
            </span>
            <span className="block text-xs text-text-muted mt-0.5">Requests rejected (400)</span>
          </div>
        </Card>

        <Card className="flex flex-col justify-between p-4">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider">Scanner errors</span>
            <span className={`material-symbols-outlined text-[20px] ${summary.errors24h ? "text-red-500" : ""}`}>
              error
            </span>
          </div>
          <div className="mt-3">
            <span className={`text-2xl font-bold tracking-tight ${summary.errors24h ? "text-red-500 dark:text-red-400" : "text-text-muted"}`}>
              {count(summary.errors24h)}
            </span>
            <span className="block text-xs text-text-muted mt-0.5">Fails open (never blocks)</span>
          </div>
        </Card>
      </div>

      {/* 24-Hour Activity Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-text-main flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-text-muted">rule</span>
              By rule
            </h3>
            {summary.truncated && (
              <Badge variant="warning" size="sm">
                Partial log
              </Badge>
            )}
          </div>
          {sortedRules.length === 0 ? (
            <p className="text-xs text-text-muted">No rule activity in the last 24 hours.</p>
          ) : (
            <div className="space-y-3">
              {sortedRules.map(item => {
                const cfg = KIND_CONFIG[item.kind] || KIND_CONFIG.pii;
                const pct = Math.max(2, Math.round((item.hits / maxRuleHits) * 100));
                return (
                  <div key={item.rule} className="space-y-1">
                    <div className="flex items-center justify-between text-xs gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono font-medium text-text-main truncate">{item.rule}</span>
                        <Badge size="sm" variant={cfg.badge}>
                          {item.kind}
                        </Badge>
                      </div>
                      <div className="text-text-muted shrink-0 text-right font-mono">
                        <span>{count(item.unique)} unique</span>
                        <span className="mx-1">/</span>
                        <span className="font-semibold text-text-main">{count(item.hits)} hits</span>
                      </div>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={`${item.rule}: ${count(item.unique)} unique, ${count(item.hits)} hits`}
                      aria-valuenow={item.hits}
                      aria-valuemin={0}
                      aria-valuemax={maxRuleHits}
                      className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
                    >
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${cfg.bar}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-text-main flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-text-muted">location_on</span>
              Where values appeared
            </h3>
          </div>
          {sortedSources.length === 0 ? (
            <p className="text-xs text-text-muted">No source activity in the last 24 hours.</p>
          ) : (
            <div className="space-y-3">
              {sortedSources.map(item => {
                const pct = Math.max(2, Math.round((item.hits / maxSourceHits) * 100));
                return (
                  <div key={item.source} className="space-y-1">
                    <div className="flex items-center justify-between text-xs gap-2">
                      <span className="font-medium text-text-main truncate">
                        {item.label}
                      </span>
                      <span className="text-text-muted shrink-0 text-right font-mono">
                        <span className="font-semibold text-text-main">{count(item.hits)}</span> hits
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={`${item.label}: ${count(item.hits)}`}
                      aria-valuenow={item.hits}
                      aria-valuemin={0}
                      aria-valuemax={maxSourceHits}
                      className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
                    >
                      <div
                        className="h-full rounded-full bg-brand-500/80 transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Scanner Health Card */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-text-main flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-text-muted">monitor_heart</span>
            Scanner health
          </h3>
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block size-2.5 rounded-full ${health?.loaded ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-red-500"}`}
              aria-hidden="true"
            />
            <span className="text-xs font-medium text-text-main">
              {health?.loaded ? "Loaded" : "Not loaded"}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg bg-surface-2/60 p-2.5 border border-border-subtle">
            <span className="text-xs text-text-muted block font-medium">Known values</span>
            <strong className="block text-base font-semibold text-text-main mt-0.5">
              {count(health?.knownCount)}
            </strong>
            <span className="text-[11px] text-text-muted block mt-0.5">{age(knownUpdated)}</span>
          </div>

          <div className="rounded-lg bg-surface-2/60 p-2.5 border border-border-subtle">
            <span className="text-xs text-text-muted block font-medium">Scanner errors</span>
            <strong className={`block text-base font-semibold mt-0.5 ${health?.errors ? "text-red-500" : "text-text-main"}`}>
              {count(health?.errors)}
            </strong>
            <span className="text-[11px] text-text-muted block mt-0.5 truncate" title={health?.lastError ? `${age(health.lastError.ts)} (${health.lastError.stage})` : "No errors"}>
              {health?.lastError ? `Last: ${age(health.lastError.ts)} (${health.lastError.stage})` : "No errors"}
            </span>
          </div>

          <div className="rounded-lg bg-surface-2/60 p-2.5 border border-border-subtle">
            <span className="text-xs text-text-muted block font-medium">Requests</span>
            <strong className="block text-base font-semibold text-text-main mt-0.5">
              {count(health?.requests)}
            </strong>
            <span className="text-[11px] text-text-muted block mt-0.5">
              {health?.withFindings !== undefined ? `${count(health.withFindings)} findings` : "all time"}
            </span>
          </div>

          <div className="rounded-lg bg-surface-2/60 p-2.5 border border-border-subtle">
            <span className="text-xs text-text-muted block font-medium">Scan latency</span>
            <strong className="block text-base font-semibold text-text-main mt-0.5 font-mono">
              p95 {count(health?.p95ScanMs)} ms
            </strong>
            <span className="text-[11px] text-text-muted block mt-0.5 font-mono">
              max {count(health?.maxScanMs)} ms
            </span>
          </div>

          <div className="rounded-lg bg-surface-2/60 p-2.5 border border-border-subtle">
            <span className="text-xs text-text-muted block font-medium">Unscanned images</span>
            <strong className="block text-base font-semibold text-text-main mt-0.5">
              {count(health?.unscanned?.images)}
            </strong>
          </div>

          <div className="rounded-lg bg-surface-2/60 p-2.5 border border-border-subtle">
            <span className="text-xs text-text-muted block font-medium">Unscanned files</span>
            <strong className="block text-base font-semibold text-text-main mt-0.5">
              {count(health?.unscanned?.files)}
            </strong>
          </div>

          <div className="rounded-lg bg-surface-2/60 p-2.5 border border-border-subtle">
            <span className="text-xs text-text-muted block font-medium">Unscanned opaque</span>
            <strong className="block text-base font-semibold text-text-main mt-0.5">
              {count(health?.unscanned?.opaque)}
            </strong>
          </div>

          <div className="rounded-lg bg-surface-2/60 p-2.5 border border-border-subtle">
            <span className="text-xs text-text-muted block font-medium">Scanner uptime</span>
            <strong className="block text-base font-semibold text-text-main mt-0.5">
              {health?.since ? age(health.since) : "active"}
            </strong>
            <span className="text-[11px] text-text-muted block mt-0.5">
              {count(health?.seen)} total seen
            </span>
          </div>
        </div>
      </Card>

      {/* Rules Card */}
      <Card>
        <div className="mb-3">
          <h3 className="font-semibold text-text-main flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-text-muted">tune</span>
            Rules
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            Default follows the default mode. The known rule matches values from ~/.config/pii-guard/known.json.
          </p>
        </div>
        <div className="divide-y divide-border border-t border-border">
          {rules.map(r => {
            const warning = summary.ruleWarnings?.[r.id];
            const hits24h = summary.byRule?.[r.id]?.hits || 0;
            return (
              <div key={r.id} className="flex items-center justify-between gap-4 py-2.5 flex-wrap">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-semibold text-text-main">{r.id}</span>
                    <Badge size="sm" variant={KIND_CONFIG[r.kind]?.badge || "default"}>
                      {r.kind}
                    </Badge>
                    {r.id === "known" && (
                      <span className="text-xs text-text-muted">({count(r.count)} values)</span>
                    )}
                    <span className="text-xs text-text-muted font-mono">
                      · {count(hits24h)} hits / 24h
                    </span>
                  </div>
                  {warning && (
                    <div>
                      <Badge variant="warning" size="sm" icon="warning">
                        {Math.round(warning.share * 100)}% in {humanizeSource(warning.topSource)}
                      </Badge>
                    </div>
                  )}
                </div>
                <SegmentedControl
                  size="sm"
                  options={[{ value: "default", label: "Default" }, ...MODES]}
                  value={config.rules?.[r.id] || "default"}
                  onChange={mode => { if (confirmBlock(mode)) save({ rules: { [r.id]: mode } }); }}
                />
              </div>
            );
          })}
        </div>
      </Card>

      {/* Findings Table Card */}
      <Card>
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h3 className="font-semibold text-text-main flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-text-muted">search_check</span>
              Findings
              <span className="text-xs font-normal text-text-muted">
                ({count(filteredGroups.length)}{filteredGroups.length !== (summary.groups || []).length ? ` of ${count((summary.groups || []).length)}` : ""})
              </span>
            </h3>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant={showIgnored ? "primary" : "secondary"}
              onClick={() => setShowIgnored(v => !v)}
              aria-pressed={showIgnored}
            >
              {showIgnored ? "Hide ignored" : "Show ignored"}
            </Button>
            <Button size="sm" variant="secondary" onClick={load}>
              Refresh
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="w-full sm:w-48">
            <Select
              placeholder="All rules"
              value={ruleFilter}
              onChange={e => setRuleFilter(e.target.value)}
              options={ruleFilterOptions}
            />
          </div>
          <div className="relative flex-1 min-w-[200px]">
            <span className="material-symbols-outlined absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted text-[18px]">
              search
            </span>
            <input
              type="text"
              placeholder="Filter by rule, name, or hash..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              aria-label="Filter findings by rule, name, or hash"
              className="w-full py-2.5 pl-9 pr-3 text-sm text-text-main bg-surface-2 rounded-[10px] border border-transparent placeholder-text-muted/70 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40"
            />
          </div>
        </div>

        {filteredGroups.length === 0 ? (
          <div className="py-8 text-center text-sm text-text-muted">No findings matched filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-text-muted border-b border-border">
                <tr>
                  <th className="py-2.5 pr-3 font-semibold">Rule / name</th>
                  <th className="py-2.5 pr-3 font-semibold">Where</th>
                  <th className="py-2.5 pr-3 font-semibold">What happened</th>
                  <th className="py-2.5 pr-3 font-semibold">First seen</th>
                  <th className="py-2.5 pr-3 font-semibold">Last seen</th>
                  <th className="py-2.5 pr-3 font-semibold">Turns</th>
                  <th className="py-2.5 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {displayedGroups.map(group => (
                  <tr key={`${group.rule}:${group.hash}`} className="align-middle hover:bg-surface-2/40 transition-colors">
                    <td className="py-2.5 pr-3">
                      <span className="font-medium text-text-main">{group.name || group.rule}</span>
                      <span className="block font-mono text-xs text-text-muted">{group.rule}</span>
                      <span className="font-mono text-[10px] text-text-muted block truncate max-w-[140px] opacity-75">{group.hash}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-text-muted">
                      {group.sources.map(humanizeSource).join(", ")}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {group.actions.map(action => (
                          <Badge
                            key={action}
                            size="sm"
                            variant={ACTION_BADGE_VARIANT[action] || "default"}
                          >
                            {action}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap text-text-muted" title={new Date(group.firstSeen).toLocaleString()}>
                      {age(group.firstSeen)}
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap font-medium text-text-main" title={new Date(group.lastSeen).toLocaleString()}>
                      {age(group.lastSeen)}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-text-muted">
                      {count(group.turns)}
                    </td>
                    <td className="py-2.5 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => save({ ignore: group.hash, on: !group.ignored })}
                      >
                        {group.ignored ? "Unignore" : "Ignore"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {filteredGroups.length > 100 && (
          <div className="p-3 text-center border-t border-border bg-surface-2/30">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowAllRows(v => !v)}
            >
              {showAllRows ? "Show fewer (first 100)" : `Show all (${count(filteredGroups.length)} findings)`}
            </Button>
          </div>
        )}

        <details className="mt-4 text-xs">
          <summary className="cursor-pointer text-text-muted font-medium hover:text-text-main transition-colors">
            Recent event details ({recent.filter(e => e.type !== "stats").length} events)
          </summary>
          <ul className="mt-2 space-y-1 max-h-64 overflow-y-auto rounded-lg bg-surface-2/40 p-2.5 border border-border-subtle font-mono text-[11px]">
            {recent.filter(e => e.type !== "stats").map((event, i) => (
              <li key={`${event.ts}:${i}`} className="text-text-muted">
                <span className="text-text-main">{event.ts}</span> · {event.model || event.stage || "event"} · {Object.entries(event.counts || {}).map(([k, n]) => `${k}=${n}`).join(", ")} · {[...(event.hits || event.new || []).map(hit => hit.action).filter(Boolean), ...(event.blocked ? ["blocked"] : []), ...(event.redacted ? ["redacted"] : [])].join(", ")}
              </li>
            ))}
          </ul>
        </details>
      </Card>

      {/* Scanner Test Card */}
      <Card>
        <div className="mb-3">
          <h3 className="font-semibold text-text-main flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-text-muted">science</span>
            Scanner test
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            Scan a text to preview a mode before you save it. The text is not sent to any provider.
          </p>
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={3}
          aria-label="Text to scan"
          className="w-full rounded-[10px] border border-border bg-surface-2 p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        />
        <div className="mt-3 flex items-end gap-2 flex-wrap">
          <Select
            label="Test with"
            className="w-56"
            value={testMode}
            onChange={e => { setTestMode(e.target.value); setResult(null); }}
            options={[{ value: "current", label: "Current settings" }, ...MODES.map(m => ({ value: m.value, label: `${m.label} (all rules)` }))]}
          />
          <Button variant="secondary" onClick={runTest}>Scan</Button>
        </div>
        {result && (
          <div className="mt-4 space-y-3 pt-3 border-t border-border text-sm">
            {result.findings.length === 0 ? (
              <p className="text-text-muted text-xs">No findings detected.</p>
            ) : (
              <ul className="space-y-1.5">
                {result.findings.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 font-mono text-xs flex-wrap">
                    <Badge size="sm" variant={ACTION_BADGE_VARIANT[f.action] || "default"}>
                      {f.action}
                    </Badge>
                    <span className="font-semibold text-text-main">{f.name || f.rule}:</span>
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-text-muted">{f.match}</span>
                  </li>
                ))}
              </ul>
            )}
            {result.blocked.length > 0 && (
              <p className="text-xs text-red-500 font-medium">
                A real request would be blocked: {result.blocked.join(", ")}
              </p>
            )}
            <div>
              <p className="text-xs text-text-muted mb-1 font-medium">Text sent upstream:</p>
              <pre className="whitespace-pre-wrap rounded-[10px] bg-surface-2 p-3 font-mono text-xs text-text-main border border-border-subtle">{result.redacted}</pre>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
