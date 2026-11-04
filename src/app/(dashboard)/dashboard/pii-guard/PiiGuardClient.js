"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, SegmentedControl, Select } from "@/shared/components";

const MODES = [
  { value: "off", label: "Off" },
  { value: "observe", label: "Observe" },
  { value: "redact", label: "Redact" },
  { value: "block", label: "Block" },
];
const MODE_HELP = {
  off: "No scan. Requests pass unchanged.",
  observe: "Scan and log findings. Requests pass unchanged.",
  redact: "Replace matches in user messages and tool results with placeholders such as {{pii:pan#ab12cd}}.",
  block: "Reject requests that contain a match (HTTP 400).",
};
const ACTION_COLOR = { off: "text-text-muted", observe: "text-blue-500", redact: "text-yellow-500", block: "text-red-500", leaked: "text-red-500", ignored: "text-text-muted" };
const count = value => Number(value || 0).toLocaleString();
const age = value => {
  if (!value) return "unknown";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  return ms < 60_000 ? `${Math.floor(ms / 1000)}s ago` : ms < 3_600_000 ? `${Math.floor(ms / 60_000)}m ago` : `${Math.floor(ms / 3_600_000)}h ago`;
};

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

  const load = useCallback(() => call().then(setState).catch(e => setError(e.message)), []);
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load]);

  const save = patch => call(patch).then(s => { setState(s); setError(""); }).catch(e => setError(e.message));
  const confirmBlock = mode => mode !== "block" || window.confirm("Block stops the first request that contains a new value. Later requests redact it. Continue?");
  const chooseMode = mode => { if (confirmBlock(mode)) save({ mode }); };
  const runTest = () => call({ test: text, testMode }).then(r => { setResult(r); setError(""); }).catch(e => setError(e.message));

  if (!state) return <div className="p-6 text-text-muted">{error || "Loading..."}</div>;
  const { config = { mode: "observe", rules: {}, ignore: [] }, rules = [], recent = [], summary = {}, health = null, enabled, available } = state;
  const groups = (summary.groups || []).filter(group => showIgnored || !group.ignored);
  const knownUpdated = health?.knownUpdated;

  return (
    <div className="space-y-6 p-6">
      {error && <div className="text-sm text-red-500" role="alert">{error}</div>}
      {!enabled && <Card><p className="text-sm">PII_GUARD_MODULE is not set. Set it in the service drop-in and restart 9Router.</p></Card>}
      {enabled && !available && <Card><p className="text-sm text-red-500">Scanner did not load. Check the console log for [pii-guard] lines.</p></Card>}

      <Card>
        <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-primary">shield_person</span>
          PII Guard
        </h2>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">Default mode</p>
            <p className="text-sm text-text-muted">{MODE_HELP[config.mode]}</p>
          </div>
          <SegmentedControl options={MODES} value={config.mode} onChange={mode => chooseMode(mode)} />
        </div>
        <p className="text-xs text-text-muted mt-3">
          Redact changes only user messages and tool results. System prompts and assistant history stay unchanged.
          A scanner error never blocks a request.
        </p>
      </Card>

      <Card>
        <h3 className="font-semibold mb-3">Last 24 hours{summary.truncated && <span className="ml-2 text-xs text-yellow-600">(partial: log too large, oldest events not read)</span>}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><strong className="block text-xl">{count(summary.unique24h)}</strong><span className="text-text-muted">Unique values</span></div>
          <div><strong className={`block text-xl ${summary.leaked24h ? "text-red-500" : ""}`}>{count(summary.leaked24h)}</strong><span className="text-text-muted">Leaked through</span></div>
          <div><strong className="block text-xl">{count(summary.blocked24h)}</strong><span className="text-text-muted">Blocked values</span></div>
          <div><strong className="block text-xl">{count(summary.errors24h)}</strong><span className="text-text-muted">Scanner errors</span></div>
        </div>
        <div className="mt-4 grid md:grid-cols-2 gap-4 text-sm">
          <div><p className="font-medium mb-1">By rule</p>{Object.entries(summary.byRule || {}).map(([rule, value]) => <p key={rule} className="text-text-muted">{rule}: {count(value.unique)} unique / {count(value.hits)} hits</p>)}</div>
          <div><p className="font-medium mb-1">Where values appeared</p>{Object.entries(summary.bySource || {}).map(([source, n]) => <p key={source} className="text-text-muted">{source}: {count(n)}</p>)}</div>
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold mb-3">Scanner health</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <p>Loaded: <strong>{health?.loaded ? "Yes" : "No"}</strong></p>
          <p>Known values: <strong>{count(health?.knownCount)}</strong> <span className="text-text-muted">({age(knownUpdated)})</span></p>
          <p>Scanner errors: <strong>{count(health?.errors)}</strong>{health?.lastError && <span className="block text-text-muted">Last: {age(health.lastError.ts)} ({health.lastError.stage})</span>}</p>
          <p>Requests: <strong>{count(health?.requests)}</strong></p>
          <p>Scan time: <strong>p95 {count(health?.p95ScanMs)} ms / max {count(health?.maxScanMs)} ms</strong></p>
          <p>Unscanned images: <strong>{count(health?.unscanned?.images)}</strong></p>
          <p>Unscanned files: <strong>{count(health?.unscanned?.files)}</strong></p>
          <p>Unscanned opaque: <strong>{count(health?.unscanned?.opaque)}</strong></p>
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold mb-1">Test</h3>
        <p className="text-sm text-text-muted mb-3">Scan a text to preview a mode before you save it. The text is not sent to any provider.</p>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={3}
          aria-label="Text to scan"
          className="w-full rounded-lg border border-border bg-surface-2 p-3 text-sm font-mono"
        />
        <div className="mt-2 flex items-end gap-2 flex-wrap">
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
          <div className="mt-4 space-y-2 text-sm">
            {result.findings.length === 0 ? <p className="text-text-muted">No findings.</p> : (
              <ul className="space-y-1">
                {result.findings.map((f, i) => (
                  <li key={i} className="font-mono">
                    <span className={ACTION_COLOR[f.action]}>{f.action}</span> {f.name || f.rule}: {f.match}
                  </li>
                ))}
              </ul>
            )}
            {result.blocked.length > 0 && <p className="text-red-500">A real request would be blocked: {result.blocked.join(", ")}</p>}
            <p className="text-text-muted">Text sent upstream:</p>
            <pre className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-mono">{result.redacted}</pre>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="font-semibold mb-1">Rules</h3>
        <p className="text-sm text-text-muted mb-3">Default follows the default mode. The known rule matches values from ~/.config/pii-guard/known.json.</p>
        <div className="divide-y divide-border">
          {rules.map(r => {
            const warning = summary.ruleWarnings?.[r.id];
            return <div key={r.id} className="flex items-center justify-between gap-4 py-2 flex-wrap">
              <div className="min-w-0">
                <span className="font-mono text-sm">{r.id}</span>
                <span className="ml-2 text-xs text-text-muted">{r.kind}{r.id === "known" ? ` (${r.count} values)` : ""} · {count(summary.byRule?.[r.id]?.hits)} hits / 24h</span>
                {warning && <p className="text-xs text-yellow-600">{Math.round(warning.share * 100)}% of hits in {warning.topSource}</p>}
              </div>
              <SegmentedControl
                size="sm"
                options={[{ value: "default", label: "Default" }, ...MODES]}
                value={config.rules?.[r.id] || "default"}
                onChange={mode => { if (confirmBlock(mode)) save({ rules: { [r.id]: mode } }); }}
              />
            </div>;
          })}
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h3 className="font-semibold">Findings</h3>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setShowIgnored(value => !value)} aria-pressed={showIgnored}>{showIgnored ? "Hide ignored" : "Show ignored"}</Button>
            <Button size="sm" variant="secondary" onClick={load}>Refresh</Button>
          </div>
        </div>
        {groups.length === 0 ? <p className="text-sm text-text-muted">No findings yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-text-muted">
                <tr><th className="py-1 pr-3">Rule / name</th><th className="pr-3">Where</th><th className="pr-3">What happened</th><th className="pr-3">First seen</th><th className="pr-3">Last seen</th><th className="pr-3">Turns</th><th>Action</th></tr>
              </thead>
              <tbody>
                {groups.map(group => (
                  <tr key={`${group.rule}:${group.hash}`} className="border-t border-border align-top">
                    <td className="py-1 pr-3">{group.name || group.rule}<span className="block font-mono text-xs text-text-muted">{group.rule}</span></td>
                    <td className="pr-3">{group.sources.join(", ")}</td>
                    <td className="pr-3">{group.actions.map(action => <span key={action} className={`${ACTION_COLOR[action] || ""} mr-2`}>{action}</span>)}</td>
                    <td className="pr-3 whitespace-nowrap">{new Date(group.firstSeen).toLocaleString()}</td>
                    <td className="pr-3 whitespace-nowrap">{new Date(group.lastSeen).toLocaleString()}</td>
                    <td className="pr-3">{count(group.turns)}</td>
                    <td><Button size="sm" variant="secondary" onClick={() => save({ ignore: group.hash, on: !group.ignored })}>{group.ignored ? "Unignore" : "Ignore"}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-text-muted">Recent event details</summary>
          <ul className="mt-2 space-y-1">{recent.filter(e => e.type !== "stats").map((event, i) => <li key={`${event.ts}:${i}`} className="font-mono text-xs">{event.ts} · {event.model || event.stage || "event"} · {Object.entries(event.counts || {}).map(([k, n]) => `${k}=${n}`).join(", ")} · {[...(event.hits || event.new || []).map(hit => hit.action).filter(Boolean), ...(event.blocked ? ["blocked"] : []), ...(event.redacted ? ["redacted"] : [])].join(", ")}</li>)}</ul>
        </details>
      </Card>
    </div>
  );
}
