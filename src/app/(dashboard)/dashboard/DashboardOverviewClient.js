"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Card, Button, Skeleton } from "@/shared/components";
import { CLI_TOOLS } from "@/shared/constants/cliTools";
import { isCliToolConfigured } from "@/shared/components/ConfigStatusBadge";
import { getRelativeTime } from "@/shared/utils";
import { AI_PROVIDERS } from "@/shared/constants/providers";

const POLL_INTERVAL_MS = 15000;

const QUICK_LINKS = [
  { href: "/dashboard/endpoint", label: "Endpoint", icon: "api", desc: "URLs, tunnel, API keys" },
  { href: "/dashboard/providers", label: "Providers", icon: "dns", desc: "Connect AI accounts" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal", desc: "Point local tools here" },
  { href: "/dashboard/basic-chat", label: "Basic Chat", icon: "chat", desc: "Chat with connected models" },
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart", desc: "Tokens, costs, request logs" },
  { href: "/dashboard/combos", label: "Combos", icon: "layers", desc: "Model failover chains" },
  { href: "/dashboard/profile", label: "Security", icon: "shield", desc: "Password and login" },
];

function getConnectionStatus(conn) {
  if (conn.isActive === false) return "disabled";
  const s = conn.testStatus;
  if (s === "active" || s === "success") return "ok";
  if (s === "error" || s === "expired") return "error";
  if (s === "unavailable") return "unavailable";
  return "unknown";
}

function getProviderLabel(conn) {
  if (conn.name) return conn.name;
  const info = AI_PROVIDERS[conn.provider];
  return info?.name || conn.provider;
}

function StatusDot({ status, size = "sm" }) {
  const cls = {
    ok: "bg-success",
    error: "bg-danger",
    unavailable: "bg-warning",
    disabled: "bg-surface-3",
    unknown: "bg-text-subtle",
  }[status] || "bg-text-subtle";
  const sz = size === "sm" ? "size-2" : "size-2.5";
  return <span className={`inline-block rounded-full shrink-0 ${sz} ${cls}`} />;
}

function HealthPill({ icon, label, value, href, status }) {
  const colorMap = {
    ok: "text-success",
    error: "text-danger",
    warning: "text-warning",
    muted: "text-text-muted",
  };
  const base = "flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-surface/60 text-xs whitespace-nowrap transition-colors";
  const hover = href ? "hover:border-primary/40 hover:bg-surface cursor-pointer" : "";
  const content = (
    <div className={`${base} ${hover}`}>
      <span className={`material-symbols-outlined text-[14px] ${colorMap[status] || "text-text-muted"}`}>{icon}</span>
      <span className="text-text-muted">{label}</span>
      <span className={`font-semibold ${colorMap[status] || "text-text-main"}`}>{value}</span>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

function SkeletonPill() {
  return <Skeleton className="h-7 w-28 rounded-full" />;
}

export default function DashboardOverviewClient() {
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState([]);
  const [cliStats, setCli] = useState({ configured: 0, total: 0 });
  const [usageStats, setUsageStats] = useState(null);
  const [tunnelStatus, setTunnelStatus] = useState(null);

  const refresh = useCallback(async (cancelled) => {
    try {
      const [providersRes, cliRes, usageRes, tunnelRes] = await Promise.all([
        fetch("/api/providers"),
        fetch("/api/cli-tools/all-statuses"),
        fetch("/api/usage/stats?period=today"),
        fetch("/api/tunnel/status", { cache: "no-store" }),
      ]);
      if (cancelled?.()) return;
      if (providersRes.ok) setConnections((await providersRes.json()).connections || []);
      if (cliRes.ok) {
        const statuses = await cliRes.json();
        const toolIds = Object.keys(CLI_TOOLS);
        let configured = 0;
        for (const id of toolIds) if (isCliToolConfigured(statuses[id])) configured++;
        setCli({ configured, total: toolIds.length });
      }
      if (usageRes.ok) setUsageStats(await usageRes.json());
      if (tunnelRes.ok) setTunnelStatus(await tunnelRes.json());
    } catch { /* ignore */ }
    finally { if (!cancelled?.()) setLoading(false); }
  }, []);

  useEffect(() => {
    let dead = false;
    refresh(() => dead);
    const id = setInterval(() => { if (!document.hidden) refresh(() => dead); }, POLL_INTERVAL_MS);
    const onVisible = () => { if (!document.hidden) refresh(() => dead); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { dead = true; clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);

  // Derived health values
  const activeConns = connections.filter(c => c.isActive !== false);
  const errorConns = activeConns.filter(c => getConnectionStatus(c) === "error");
  const providerStatus = errorConns.length > 0 ? "error" : activeConns.length > 0 ? "ok" : "muted";

  const tunnelOn = tunnelStatus?.tunnel?.settingsEnabled || tunnelStatus?.tunnel?.enabled;
  const tailscaleOn = tunnelStatus?.tailscale?.settingsEnabled || tunnelStatus?.tailscale?.enabled;
  const remoteOn = tunnelOn || tailscaleOn;
  const remoteStatus = remoteOn ? "ok" : "muted";

  const requestsToday = usageStats?.totalRequests ?? null;
  const recentRequests = (usageStats?.recentRequests || []).slice(0, 8);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">

      {/* Health pill strip */}
      <div className="flex flex-wrap gap-2">
        {loading ? (
          <>
            <SkeletonPill /><SkeletonPill /><SkeletonPill /><SkeletonPill />
          </>
        ) : (
          <>
            <HealthPill
              icon="dns"
              label="Providers"
              value={activeConns.length === 0 ? "None" : errorConns.length > 0 ? `${errorConns.length} error` : `${activeConns.length} connected`}
              status={providerStatus}
              href="/dashboard/providers"
            />
            <HealthPill
              icon="public"
              label="Remote"
              value={remoteOn ? "On" : "Off"}
              status={remoteStatus}
              href="/dashboard/endpoint"
            />
            <HealthPill
              icon="terminal"
              label="CLI tools"
              value={cliStats.total ? `${cliStats.configured}/${cliStats.total}` : "None"}
              status={cliStats.configured > 0 ? "ok" : "muted"}
              href="/dashboard/cli-tools"
            />
            <HealthPill
              icon="bar_chart"
              label="Today"
              value={requestsToday != null ? new Intl.NumberFormat().format(requestsToday) : "—"}
              status={requestsToday > 0 ? "ok" : "muted"}
              href="/dashboard/usage"
            />
          </>
        )}
      </div>

      {/* Provider health + Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Provider health list */}
        <Card padding="sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <span className="material-symbols-outlined text-primary text-[16px]">dns</span>
              Provider Health
            </h2>
            <Link href="/dashboard/providers" className="text-xs text-primary hover:underline">Manage</Link>
          </div>
          {loading ? (
            <div className="flex flex-col gap-2">
              {[1,2,3].map(i => <Skeleton key={i} className="h-9 rounded-lg" />)}
            </div>
          ) : activeConns.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <span className="material-symbols-outlined text-text-subtle text-[28px]">dns</span>
              <p className="text-sm text-text-muted">No providers connected</p>
              <Link href="/dashboard/providers">
                <Button size="sm" variant="outline">Add provider</Button>
              </Link>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border-subtle">
              {activeConns.slice(0, 8).map(conn => {
                const status = getConnectionStatus(conn);
                const label = getProviderLabel(conn);
                const provInfo = AI_PROVIDERS[conn.provider];
                const provBrand = provInfo?.name || conn.provider?.toUpperCase() || "—";
                return (
                  <Link
                    key={conn.id}
                    href={`/dashboard/providers/${conn.provider}`}
                    className="flex items-center gap-3 py-2 group"
                  >
                    <StatusDot status={status} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{label}</p>
                      {provBrand !== label && (
                        <p className="text-xs text-text-muted truncate">{provBrand}</p>
                      )}
                    </div>
                    {conn.lastErrorAt && status === "error" && (
                      <span className="text-xs text-text-subtle shrink-0">{getRelativeTime(conn.lastErrorAt)}</span>
                    )}
                    {status === "error" && (
                      <span className="shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-danger/10 text-danger">Error</span>
                    )}
                    {status === "ok" && (
                      <span className="shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-success/10 text-success">OK</span>
                    )}
                  </Link>
                );
              })}
              {activeConns.length > 8 && (
                <div className="pt-2">
                  <Link href="/dashboard/providers" className="text-xs text-primary hover:underline">
                    +{activeConns.length - 8} more providers
                  </Link>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Recent requests */}
        <Card padding="sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <span className="material-symbols-outlined text-primary text-[16px]">history</span>
              Recent Requests
            </h2>
            <Link href="/dashboard/usage" className="text-xs text-primary hover:underline">View all</Link>
          </div>
          {loading ? (
            <div className="flex flex-col gap-2">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-8 rounded-lg" />)}
            </div>
          ) : recentRequests.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <span className="material-symbols-outlined text-text-subtle text-[28px]">history</span>
              <p className="text-sm text-text-muted">No requests yet</p>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border-subtle">
              {recentRequests.map((r, i) => {
                const tokens = (r.promptTokens || 0) + (r.completionTokens || 0);
                const isError = r.status && r.status !== "ok" && r.status !== "success";
                return (
                  <div key={i} className="flex items-center gap-2 py-2 min-w-0">
                    <span className={`shrink-0 material-symbols-outlined text-[14px] ${isError ? "text-danger" : "text-success"}`}>
                      {isError ? "error" : "check_circle"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-mono truncate text-text-main">{r.model || "—"}</p>
                      <p className="text-[11px] text-text-muted truncate">{r.provider?.toUpperCase() || "—"}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      {tokens > 0 && (
                        <p className="text-xs text-text-muted tabular-nums">{new Intl.NumberFormat().format(tokens)} tok</p>
                      )}
                      <p className="text-[11px] text-text-subtle">{getRelativeTime(r.timestamp)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Quick links */}
      <div>
        <h2 className="text-sm font-semibold text-text-main mb-3">Quick links</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {QUICK_LINKS.map((link) => (
            <Link key={link.href} href={link.href}>
              <Card padding="sm" className="h-full hover:border-primary/40 hover:shadow-[var(--shadow-warm)] transition-all">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-primary text-[20px]">{link.icon}</span>
                  <div>
                    <p className="text-sm font-medium">{link.label}</p>
                    <p className="text-xs text-text-muted mt-0.5">{link.desc}</p>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* CTA */}
      <Card padding="sm" className="bg-primary/5 border-primary/20">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Ready to connect a coding tool?</p>
            <p className="text-xs text-text-muted mt-0.5">Copy your endpoint URL and API key from the Endpoint page.</p>
          </div>
          <Link href="/dashboard/endpoint">
            <Button variant="primary" size="sm">Open Endpoint</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
