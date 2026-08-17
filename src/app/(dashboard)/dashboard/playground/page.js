"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardSkeleton, Input } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

/**
 * Playground -- send one prompt to up to 4 models at once and compare the
 * answers side by side (the same idea as a Fusion combo, minus the judge).
 *
 * Blocked models are selectable on purpose: blocking only hides a model from
 * /v1/models, it stays routable, so this is where you check whether it works
 * before allowing it again.
 */
const MAX_MODELS = 4;

export default function PlaygroundPage() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [search, setSearch] = useState("");
  const [showBlocked, setShowBlocked] = useState(true);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState([]);
  const notify = useNotificationStore();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/models/access", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load models");
      setProviders(data.providers || []);
    } catch (e) {
      notify.error(e.message || "Failed to load models");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  // Flat list of routable ids, exactly as the endpoint names them.
  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = [];
    for (const p of providers) {
      for (const m of p.models || []) {
        if (m.blocked && !showBlocked) continue;
        const id = p.routePrefix ? `${p.routePrefix}/${m.id}` : m.id;
        if (q && !`${p.name} ${id}`.toLowerCase().includes(q)) continue;
        out.push({ id, provider: p.name, blocked: m.blocked, combo: m.combo });
      }
    }
    return out;
  }, [providers, search, showBlocked]);

  const toggle = (id) => {
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((m) => m !== id);
      if (cur.length >= MAX_MODELS) {
        notify.error(`Pick at most ${MAX_MODELS} models`);
        return cur;
      }
      return [...cur, id];
    });
  };

  const run = async () => {
    if (!selected.length || !prompt.trim()) return;
    setRunning(true);
    setResults([]);
    try {
      const res = await fetch("/api/playground/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          models: selected,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Request failed");
      setResults(data.results || []);
    } catch (e) {
      notify.error(e.message || "Request failed");
    } finally {
      setRunning(false);
    }
  };

  if (loading) return <CardSkeleton />;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Playground</h1>
            <p className="text-xs text-text-muted mt-0.5">
              Send one prompt to up to {MAX_MODELS} models at once and compare the answers.
              Blocked models can be picked here — blocking only hides a model from
              <code className="mx-1 rounded bg-sidebar px-1">/v1/models</code>, it stays routable.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={selected.length ? "success" : "default"}>
              {selected.length}/{MAX_MODELS} selected
            </Badge>
            <Button size="sm" variant="secondary" icon="refresh" onClick={load}>Refresh</Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="min-w-[220px] flex-1">
            <Input
              placeholder="Search model or provider..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant={showBlocked ? "primary" : "ghost"}
            onClick={() => setShowBlocked((v) => !v)}
          >
            {showBlocked ? "Showing blocked" : "Hiding blocked"}
          </Button>
          {selected.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
          )}
        </div>

        <div className="mt-3 grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {options.map((o) => {
            const on = selected.includes(o.id);
            return (
              <button
                key={o.id}
                onClick={() => toggle(o.id)}
                className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                  on ? "border-primary bg-primary/10" : "border-border hover:bg-surface-2"
                }`}
              >
                <span className="min-w-0">
                  <span className={`block truncate font-mono ${o.blocked ? "text-text-muted" : ""}`}>{o.id}</span>
                  <span className="text-[10px] text-text-muted">
                    {o.provider}{o.combo ? " · combo" : ""}{o.blocked ? " · blocked" : ""}
                  </span>
                </span>
                {on && <span className="material-symbols-outlined text-[16px] text-primary">check_circle</span>}
              </button>
            );
          })}
          {options.length === 0 && (
            <p className="col-span-full py-4 text-center text-sm text-text-muted">No models match.</p>
          )}
        </div>
      </Card>

      <Card>
        <textarea
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask all selected models the same thing..."
          className="w-full resize-y rounded-md border border-border bg-background p-2 text-sm focus:border-primary focus:outline-none"
        />
        <div className="mt-3 flex items-center gap-2">
          <Button
            icon="play_arrow"
            disabled={running || !selected.length || !prompt.trim()}
            onClick={run}
          >
            {running ? `Running ${selected.length}...` : `Run on ${selected.length || 0} model${selected.length === 1 ? "" : "s"}`}
          </Button>
          <span className="text-xs text-text-muted">Runs in parallel — each model is billed separately.</span>
        </div>
      </Card>

      {results.length > 0 && (
        <div className={`grid gap-3 ${results.length > 1 ? "md:grid-cols-2" : ""}`}>
          {results.map((r) => (
            <Card key={r.model}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="truncate font-mono text-xs font-semibold">{r.model}</span>
                <span className="flex items-center gap-2">
                  <Badge variant={r.ok ? "success" : "error"}>{r.ok ? "ok" : "failed"}</Badge>
                  <Badge variant="default">{(r.ms / 1000).toFixed(1)}s</Badge>
                  {r.usage?.total_tokens ? <Badge variant="default">{r.usage.total_tokens} tok</Badge> : null}
                </span>
              </div>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs text-text-main">
                {r.ok ? (r.content || "(empty response)") : r.error}
              </pre>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
