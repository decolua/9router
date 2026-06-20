"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Badge } from "@/shared/components";

export default function AcpAgentsPage() {
  const [agents, setAgents] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/acp/agents");
      if (!res.ok) throw new Error("Failed to load agents");
      const data = await res.json();
      setAgents(data.agents || []);
      setSummary(data.summary || null);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/acp/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });
      await load();
    } catch {
      setRefreshing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">ACP Agents</h1>
          <p className="text-sm text-text-muted mt-1">
            Detected CLI agents available via the Agent Client Protocol.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[14px]">
            {refreshing ? "sync" : "refresh"}
          </span>
          {refreshing ? "Refreshing" : "Refresh"}
        </button>
      </div>

      {summary && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge>{summary.installed} installed</Badge>
          <Badge>{summary.notFound} not found</Badge>
          {summary.custom > 0 && <Badge>{summary.custom} custom</Badge>}
        </div>
      )}

      {loading ? (
        <Card><div className="p-6 text-center text-text-muted">Detecting agents…</div></Card>
      ) : error ? (
        <Card><div className="p-6 text-center text-red-500">{error}</div></Card>
      ) : (
        <div className="space-y-2">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="flex items-center gap-3 p-4 rounded-[14px] border border-border bg-bg-card shadow-[var(--shadow-soft)]"
            >
              <span
                className={`material-symbols-outlined text-[20px] ${agent.installed ? "text-primary" : "text-text-muted"}`}
              >
                {agent.installed ? "check_circle" : "cancel"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{agent.name}</div>
                <div className="text-xs text-text-muted truncate">
                  {agent.binary} · {agent.protocol}
                  {agent.version ? ` · v${agent.version}` : ""}
                  {agent.isCustom ? " · custom" : ""}
                </div>
              </div>
              <Badge>{agent.installed ? "available" : "not installed"}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
