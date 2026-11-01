"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, Button, PageShell } from "@/shared/components";

function getStatusBadge(code) {
  const num = Number(code) || 500;
  if (num >= 500) {
    return {
      bg: "bg-danger/10 text-danger border border-danger/25",
      label: num,
      icon: "error",
    };
  }
  if (num === 429) {
    return {
      bg: "bg-warning/10 text-warning border border-warning/25",
      label: "429 Limit",
      icon: "speed",
    };
  }
  if (num === 401 || num === 403) {
    return {
      bg: "bg-primary/10 text-primary border border-primary/25",
      label: num === 403 ? "403 Forbidden" : "401 Auth",
      icon: "lock",
    };
  }
  return {
    bg: "bg-surface-2 text-text-muted border border-border-subtle",
    label: num,
    icon: "warning",
  };
}

export default function ErrorLogClient() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState(null);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/error-logs", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (err) {
      console.error("Failed to load error logs:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  const handleClear = async () => {
    if (!window.confirm("Clear all recorded error logs?")) return;
    try {
      const res = await fetch("/api/error-logs", { method: "DELETE" });
      if (res.ok) setLogs([]);
    } catch (err) {
      console.error("Failed to clear error logs:", err);
    }
  };

  const copyText = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const copyAll = () => {
    const formatted = filteredLogs
      .map(
        (l) =>
          `[${l.timestamp}] [${l.statusCode}] ${l.provider || "gateway"}/${l.model || "none"}: ${l.errorMessage}${
            l.stack ? `\nStack:\n${l.stack}` : ""
          }`
      )
      .join("\n\n---\n\n");
    copyText(formatted, "all");
  };

  const toggleExpand = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExpandAll = () => {
    if (expandedIds.size > 0) {
      setExpandedIds(new Set());
    } else {
      setExpandedIds(new Set(filteredLogs.map((l) => l.id)));
    }
  };

  const metrics = useMemo(() => {
    let server5xx = 0;
    let rate429 = 0;
    let auth4xx = 0;
    const providers = new Set();
    for (const l of logs) {
      const c = Number(l.statusCode) || 500;
      if (c >= 500) server5xx++;
      else if (c === 429) rate429++;
      else if (c === 401 || c === 403) auth4xx++;
      if (l.provider) providers.add(l.provider);
    }
    return {
      total: logs.length,
      server5xx,
      rate429,
      auth4xx,
      uniqueProviders: providers.size,
    };
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      const code = Number(l.statusCode) || 500;
      if (statusFilter === "5xx" && code < 500) return false;
      if (statusFilter === "429" && code !== 429) return false;
      if (statusFilter === "auth" && code !== 401 && code !== 403) return false;
      if (statusFilter === "4xx" && (code < 400 || code >= 500)) return false;

      if (!search) return true;
      const term = search.toLowerCase();
      return (
        (l.errorMessage || "").toLowerCase().includes(term) ||
        (l.provider || "").toLowerCase().includes(term) ||
        (l.model || "").toLowerCase().includes(term) ||
        String(l.statusCode || "").includes(term)
      );
    });
  }, [logs, search, statusFilter]);

  return (
    <PageShell width="full" className="min-w-0">
      <div className="flex flex-col gap-4 max-w-5xl">
        {/* Header & Metrics */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-text-main flex items-center gap-2">
              <span className="material-symbols-outlined text-[24px] text-rose-500">bug_report</span>
              Error Monitor
            </h1>
            <p className="text-xs text-text-muted mt-0.5">
              Diagnostic trace records, upstream gateway exceptions, and rate limit occurrences.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {logs.length > 0 && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  icon={copiedId === "all" ? "check" : "content_copy"}
                  onClick={copyAll}
                >
                  {copiedId === "all" ? "Copied" : "Copy Filtered"}
                </Button>
                <Button size="sm" variant="danger" icon="delete" onClick={handleClear}>
                  Clear All
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" icon="refresh" onClick={fetchLogs} title="Refresh logs" />
          </div>
        </div>

        {/* Quick Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="p-3 rounded-xl border border-border-subtle bg-surface flex flex-col">
            <span className="text-[11px] text-text-muted font-medium uppercase tracking-wider">Total Recorded</span>
            <span className="text-lg font-bold text-text-main mt-0.5">{metrics.total}</span>
          </div>
          <div className="p-3 rounded-xl border border-danger/20 bg-danger/5 flex flex-col">
            <span className="text-[11px] text-danger font-medium uppercase tracking-wider">5xx Server</span>
            <span className="text-lg font-bold text-danger mt-0.5">{metrics.server5xx}</span>
          </div>
          <div className="p-3 rounded-xl border border-warning/20 bg-warning/5 flex flex-col">
            <span className="text-[11px] text-warning font-medium uppercase tracking-wider">429 Rate Limits</span>
            <span className="text-lg font-bold text-warning mt-0.5">{metrics.rate429}</span>
          </div>
          <div className="p-3 rounded-xl border border-primary/20 bg-primary/5 flex flex-col">
            <span className="text-[11px] text-primary font-medium uppercase tracking-wider">401/403 Auth</span>
            <span className="text-lg font-bold text-primary mt-0.5">{metrics.auth4xx}</span>
          </div>
        </div>

        {/* Search & Status Filters */}
        <Card className="flex flex-col overflow-hidden border-border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-border/60 bg-surface-2/30">
            <div className="flex items-center gap-2 flex-1 min-w-[220px]">
              <span className="material-symbols-outlined text-[18px] text-text-muted">search</span>
              <input
                type="text"
                placeholder="Search error message, model, or provider..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-transparent text-xs text-text-main placeholder-text-muted/60 focus:outline-none"
              />
              {search && (
                <button onClick={() => setSearch("")} className="text-text-muted hover:text-text-main">
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {[
                { id: "all", label: `All (${logs.length})` },
                { id: "5xx", label: `5xx (${metrics.server5xx})` },
                { id: "429", label: `429 (${metrics.rate429})` },
                { id: "auth", label: `Auth (${metrics.auth4xx})` },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                    statusFilter === tab.id
                      ? "bg-primary text-white font-medium"
                      : "text-text-muted hover:text-text-main hover:bg-surface-2"
                  }`}
                >
                  {tab.label}
                </button>
              ))}

              {filteredLogs.length > 0 && (
                <button
                  onClick={toggleExpandAll}
                  className="ml-2 text-xs text-text-muted hover:text-text-main flex items-center gap-1 px-2 py-1 rounded hover:bg-surface-2"
                  title="Toggle collapse/expand all"
                >
                  <span className="material-symbols-outlined text-[15px]">
                    {expandedIds.size > 0 ? "unfold_less" : "unfold_more"}
                  </span>
                  <span>{expandedIds.size > 0 ? "Collapse All" : "Expand All"}</span>
                </button>
              )}
            </div>
          </div>

          {/* List of Error Items */}
          <div className="divide-y divide-border/40 max-h-[calc(100dvh-320px)] overflow-y-auto">
            {loading ? (
              <div className="py-16 text-center text-text-muted text-xs">Loading error records...</div>
            ) : filteredLogs.length === 0 ? (
              <div className="py-16 flex flex-col items-center justify-center text-center text-text-muted text-xs gap-2">
                <span className="material-symbols-outlined text-4xl text-emerald-500">check_circle</span>
                <span className="text-sm font-semibold text-text-main">All Systems Operational</span>
                <span className="max-w-xs text-text-muted">
                  {logs.length === 0
                    ? "No errors or exceptions have been recorded in this session."
                    : "No logged errors match the selected filter."}
                </span>
              </div>
            ) : (
              filteredLogs.map((log) => {
                const badge = getStatusBadge(log.statusCode);
                const isExpanded = expandedIds.has(log.id);

                return (
                  <div
                    key={log.id}
                    className={`p-3.5 transition-colors hover:bg-surface-2/30 ${
                      isExpanded ? "bg-surface-2/20" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5 flex-1 min-w-0">
                        <span
                          className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border tracking-wide leading-none select-none mt-0.5 ${badge.bg}`}
                        >
                          <span className="material-symbols-outlined text-[12px]">{badge.icon}</span>
                          {badge.label}
                        </span>

                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono text-text-muted text-[11px]">{log.timestamp}</span>
                            {(log.provider || log.model) && (
                              <span className="font-semibold text-primary text-[11px] bg-primary/10 px-1.5 py-0.5 rounded">
                                {log.provider ? `${log.provider}/` : ""}
                                {log.model || "global"}
                              </span>
                            )}
                          </div>

                          <div className="mt-1 text-sm font-medium text-text-main break-words">
                            {log.errorMessage}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            copyText(
                              `[${log.timestamp}] [${log.statusCode}] ${log.provider}/${log.model}: ${log.errorMessage}${
                                log.stack ? `\n\nStack:\n${log.stack}` : ""
                              }`,
                              log.id
                            );
                          }}
                          className="p-1 rounded text-text-muted hover:text-text-main hover:bg-surface-2 transition-colors"
                          title="Copy error details"
                        >
                          <span className="material-symbols-outlined text-[16px]">
                            {copiedId === log.id ? "check" : "content_copy"}
                          </span>
                        </button>

                        {log.stack && (
                          <button
                            type="button"
                            onClick={() => toggleExpand(log.id)}
                            className="p-1 rounded text-text-muted hover:text-text-main hover:bg-surface-2 transition-colors"
                            title={isExpanded ? "Collapse trace" : "View stack trace"}
                          >
                            <span className="material-symbols-outlined text-[16px]">
                              {isExpanded ? "expand_less" : "expand_more"}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>

                    {isExpanded && log.stack && (
                      <div className="mt-3 p-3 rounded-lg bg-surface-2 text-text-main font-mono text-xs overflow-x-auto whitespace-pre-wrap select-text border border-border-subtle">
                        <div className="text-[10px] text-text-muted uppercase font-sans font-semibold tracking-wider mb-1.5 flex items-center justify-between">
                          <span>Stack Trace:</span>
                          <button
                            type="button"
                            onClick={() => copyText(log.stack, `stack-${log.id}`)}
                            className="text-primary hover:underline lowercase font-mono text-[10px]"
                          >
                            {copiedId === `stack-${log.id}` ? "copied" : "copy stack"}
                          </button>
                        </div>
                        {log.stack}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
