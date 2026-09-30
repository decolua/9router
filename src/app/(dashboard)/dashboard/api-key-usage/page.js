"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Badge, Toggle } from "@/shared/components";

function formatNumber(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

function formatCost(c) {
  const v = Number(c) || 0;
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

function formatDate(iso) {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleString();
}

function relativeTime(iso) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "never";
  if (ms < 60000) return "just now";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function QuotaBar({ used, limit, percent }) {
  if (!limit) {
    return <p className="text-xs text-text-muted">No token limit</p>;
  }
  const color = percent >= 100 ? "bg-red-500" : percent >= 80 ? "bg-amber-500" : "bg-primary";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-muted">{formatNumber(used)} / {formatNumber(limit)} tokens</span>
        <span className="font-medium">{percent.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-surface-2 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.max(percent, 1.5)}%` }} />
      </div>
    </div>
  );
}

function KeyCard({ k, expanded, onToggle }) {
  const disabled = !k.isActive;
  return (
    <Card className={disabled ? "opacity-60" : ""}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm truncate">{k.name}</h3>
            {k.expired && <Badge variant="danger" size="sm">expired</Badge>}
            {!k.isActive && <Badge variant="default" size="sm">off</Badge>}
          </div>
          <p className="text-[11px] text-text-muted font-mono mt-0.5">{k.keyMasked || "no key"}</p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="text-xs text-primary hover:underline shrink-0 cursor-pointer"
        >
          {expanded ? "Hide detail" : "Detail"}
        </button>
      </div>

      <QuotaBar used={k.usedTokens} limit={k.tokenLimit} percent={k.usagePercent ?? 0} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 text-center">
        <div className="rounded-lg bg-surface-2/50 p-2">
          <p className="text-[10px] uppercase tracking-wider text-text-muted">Requests</p>
          <p className="text-sm font-semibold">{formatNumber(k.requests)}</p>
        </div>
        <div className="rounded-lg bg-surface-2/50 p-2">
          <p className="text-[10px] uppercase tracking-wider text-text-muted">Tokens</p>
          <p className="text-sm font-semibold">{formatNumber(k.totalTokens)}</p>
        </div>
        <div className="rounded-lg bg-surface-2/50 p-2">
          <p className="text-[10px] uppercase tracking-wider text-text-muted">Cost</p>
          <p className="text-sm font-semibold">{formatCost(k.cost)}</p>
        </div>
        <div className="rounded-lg bg-surface-2/50 p-2">
          <p className="text-[10px] uppercase tracking-wider text-text-muted">Errors</p>
          <p className={`text-sm font-semibold ${k.errorRate > 0.1 ? "text-red-500" : ""}`}>
            {(k.errorRate * 100).toFixed(1)}%
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-text-muted">
        <span>Last used: {relativeTime(k.lastUsed)}</span>
        {k.tokenLimit > 0 && (
          <span>Resets: {k.nextResetAt ? formatDate(k.nextResetAt) : k.resetInterval === "never" ? "never" : k.resetInterval}</span>
        )}
        {k.expiresAt && <span>Expires: {formatDate(k.expiresAt)}</span>}
        {(k.rpmLimit > 0 || k.tpmLimit > 0) && (
          <span>Limits: {k.rpmLimit > 0 ? `${k.rpmLimit} rpm` : ""}{k.rpmLimit > 0 && k.tpmLimit > 0 ? " / " : ""}{k.tpmLimit > 0 ? `${formatNumber(k.tpmLimit)} tpm` : ""}</span>
        )}
      </div>

      {expanded && (k.models?.length > 0) && (
        <div className="mt-4 pt-3 border-t border-border-subtle">
          <p className="text-[10px] uppercase tracking-wider text-text-muted mb-2">Top models</p>
          <div className="space-y-1.5">
            {k.models.map((m) => (
              <div key={m.model} className="flex items-center justify-between text-xs">
                <span className="truncate font-mono">{m.model}</span>
                <span className="text-text-muted shrink-0 ml-3">
                  {formatNumber(m.requests)} req · {formatNumber(m.tokens)} tok · {formatCost(m.cost)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export default function ApiKeyUsagePage() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/api-keys", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setKeys(data.keys || []);
      setUpdatedAt(data.generatedAt || new Date().toISOString());
      setError("");
    } catch (e) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-main">API Key Usage</h1>
          <p className="text-sm text-text-muted mt-1">
            Quota and activity per generated key
            {updatedAt ? `, updated ${relativeTime(updatedAt)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-muted">Auto refresh 10s</span>
          <Toggle checked={autoRefresh} onChange={setAutoRefresh} />
        </div>
      </div>

      {error && (
        <Card className="border-red-300 bg-red-500/5">
          <p className="text-sm text-red-500">{error}</p>
        </Card>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="h-40 animate-pulse bg-surface-2/40" />
          ))}
        </div>
      ) : keys.length === 0 ? (
        <Card>
          <p className="text-sm text-text-muted text-center py-6">
            No API keys yet. Create one under Endpoint &amp; Key.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {keys.map((k) => (
            <KeyCard
              key={k.id}
              k={k}
              expanded={expandedId === k.id}
              onToggle={() => setExpandedId(expandedId === k.id ? null : k.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
