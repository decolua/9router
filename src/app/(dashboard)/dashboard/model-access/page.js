"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardSkeleton, Input } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

/**
 * Model Access -- decides which models the final endpoint (/v1/models) exposes.
 * Blocking here writes to the same per-provider disabled list the endpoint
 * already honours, so a blocked model disappears from /v1/models and can no
 * longer be routed to.
 */
export default function ModelAccessPage() {
  const [providers, setProviders] = useState([]);
  const [totals, setTotals] = useState({ total: 0, allowed: 0, blocked: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all | allowed | blocked
  const [collapsed, setCollapsed] = useState({});
  const notify = useNotificationStore();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/models/access", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load");
      setProviders(data.providers || []);
      setTotals(data.totals || { total: 0, allowed: 0, blocked: 0 });
    } catch (e) {
      notify.error(e.message || "Failed to load model access");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const apply = async (alias, ids, action) => {
    if (!ids.length) return;
    setBusy(`${alias}:${action}`);
    try {
      const res = await fetch("/api/models/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: alias, ids, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Update failed");
      await load();
    } catch (e) {
      notify.error(e.message || "Update failed");
    } finally {
      setBusy("");
    }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return providers
      .map((p) => {
        const models = p.models.filter((m) => {
          if (filter === "allowed" && m.blocked) return false;
          if (filter === "blocked" && !m.blocked) return false;
          if (!q) return true;
          return m.id.toLowerCase().includes(q) || p.alias.toLowerCase().includes(q);
        });
        return { ...p, models };
      })
      .filter((p) => p.models.length > 0);
  }, [providers, search, filter]);

  if (loading) return <CardSkeleton />;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Model Access</h1>
            <p className="text-xs text-text-muted mt-0.5">
              Choose which models the final endpoint exposes. Blocked models are removed from
              <code className="mx-1 rounded bg-sidebar px-1">/v1/models</code>
              and can no longer be routed to.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="success">{totals.allowed} allowed</Badge>
            <Badge variant={totals.blocked ? "error" : "default"}>{totals.blocked} blocked</Badge>
            <Badge variant="default">{totals.total} total</Badge>
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
          {["all", "allowed", "blocked"].map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "primary" : "ghost"}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Button>
          ))}
        </div>
      </Card>

      {visible.length === 0 && (
        <Card>
          <p className="py-6 text-center text-sm text-text-muted">
            No models match. Connect a provider account first, or clear the filters.
          </p>
        </Card>
      )}

      {visible.map((p) => {
        const allowedIds = p.models.filter((m) => !m.blocked).map((m) => m.id);
        const blockedIds = p.models.filter((m) => m.blocked).map((m) => m.id);
        const isCollapsed = collapsed[p.alias];
        return (
          <Card key={p.alias}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                className="flex items-center gap-2 text-left"
                onClick={() => setCollapsed((c) => ({ ...c, [p.alias]: !c[p.alias] }))}
              >
                <span className="material-symbols-outlined text-base text-text-muted">
                  {isCollapsed ? "chevron_right" : "expand_more"}
                </span>
                <span className="font-semibold">{p.alias}</span>
                <Badge variant="default">{p.connections} account{p.connections === 1 ? "" : "s"}</Badge>
                <Badge variant="success">{p.allowed}</Badge>
                {p.blocked > 0 && <Badge variant="error">{p.blocked} blocked</Badge>}
              </button>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon="block"
                  disabled={!allowedIds.length || busy === `${p.alias}:block`}
                  onClick={() => apply(p.alias, allowedIds, "block")}
                >
                  Block shown
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="restart_alt"
                  disabled={!blockedIds.length || busy === `${p.alias}:allow`}
                  onClick={() => apply(p.alias, blockedIds, "allow")}
                >
                  Allow shown
                </Button>
              </div>
            </div>

            {!isCollapsed && (
              <div className="mt-3 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {p.models.map((m) => (
                  <div
                    key={m.id}
                    className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs ${
                      m.blocked ? "border-red-500/30 bg-red-500/5" : "border-border"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className={`truncate font-mono ${m.blocked ? "text-text-muted line-through" : ""}`}>
                        {`${p.alias}/${m.id}`}
                      </div>
                      {m.custom && <span className="text-[10px] text-text-muted">custom</span>}
                    </div>
                    <button
                      title={m.blocked ? "Allow on endpoint" : "Block from endpoint"}
                      className={`rounded p-1 transition-colors ${
                        m.blocked ? "text-red-500 hover:bg-red-500/10" : "text-text-muted hover:bg-sidebar hover:text-primary"
                      }`}
                      onClick={() => apply(p.alias, [m.id], m.blocked ? "allow" : "block")}
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {m.blocked ? "block" : "check_circle"}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
