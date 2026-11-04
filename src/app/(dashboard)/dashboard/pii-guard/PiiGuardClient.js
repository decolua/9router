"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, SegmentedControl } from "@/shared/components";

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
const ACTION_COLOR = { off: "text-text-muted", observe: "text-blue-500", redact: "text-yellow-500", block: "text-red-500" };

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
  const [text, setText] = useState("My mobile number is 9876543210 and PAN is ABCPE1234F.");
  const [result, setResult] = useState(null);

  const load = useCallback(() => call().then(setState).catch(e => setError(e.message)), []);
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load]);

  const save = patch => call(patch).then(s => { setState(s); setError(""); }).catch(e => setError(e.message));
  const runTest = () => call({ test: text }).then(r => { setResult(r); setError(""); }).catch(e => setError(e.message));

  if (!state) return <div className="p-6 text-text-muted">{error || "Loading..."}</div>;
  const { config, rules, events, enabled, available } = state;

  return (
    <div className="space-y-6 p-6">
      {error && <div className="text-sm text-red-500">{error}</div>}
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
          <SegmentedControl options={MODES} value={config.mode} onChange={mode => save({ mode })} />
        </div>
        <p className="text-xs text-text-muted mt-3">
          Redact changes only user messages and tool results. System prompts and assistant history stay unchanged.
          A scanner error never blocks a request.
        </p>
      </Card>

      <Card>
        <h3 className="font-semibold mb-1">Test</h3>
        <p className="text-sm text-text-muted mb-3">Scan a text with the current settings. The text is not sent to any provider.</p>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={3}
          aria-label="Text to scan"
          className="w-full rounded-lg border border-border bg-surface-2 p-3 text-sm font-mono"
        />
        <Button className="mt-2" onClick={runTest}>Scan</Button>
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
          {rules.map(r => (
            <div key={r.id} className="flex items-center justify-between gap-4 py-2 flex-wrap">
              <div className="min-w-0">
                <span className="font-mono text-sm">{r.id}</span>
                <span className="ml-2 text-xs text-text-muted">{r.kind}{r.id === "known" ? ` (${r.count} values)` : ""}</span>
              </div>
              <SegmentedControl
                size="sm"
                options={[{ value: "default", label: "Default" }, ...MODES]}
                value={config.rules[r.id] || "default"}
                onChange={mode => save({ rules: { [r.id]: mode } })}
              />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Recent findings</h3>
          <Button size="sm" variant="secondary" onClick={load}>Refresh</Button>
        </div>
        {events.length === 0 ? <p className="text-sm text-text-muted">No findings yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-text-muted">
                <tr><th className="py-1 pr-3">Time</th><th className="pr-3">Model</th><th className="pr-3">Client</th><th className="pr-3">Findings</th><th>Action</th></tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i} className="border-t border-border align-top">
                    <td className="py-1 pr-3 whitespace-nowrap">{new Date(e.ts).toLocaleString()}</td>
                    <td className="pr-3 font-mono">{e.model}</td>
                    <td className="pr-3 font-mono">{e.ua}</td>
                    <td className="pr-3 font-mono">{Object.entries(e.counts || {}).map(([k, n]) => `${k}=${n}`).join(", ")}</td>
                    <td className={e.blocked ? "text-red-500" : e.redacted ? "text-yellow-500" : "text-blue-500"}>
                      {e.blocked ? "blocked" : e.redacted ? "redacted" : "observed"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
