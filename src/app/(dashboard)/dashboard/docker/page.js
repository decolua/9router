"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardSkeleton, Toggle } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { cn } from "@/shared/utils/cn";

function fmtBytes(bytes) {
  if (!bytes) return "0B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  if (i < 0) return "0B";
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2) + units[i];
}

function parseMem(val) {
  if (!val) return 0;
  const match = val.match(/^([\d.]+)\s*(\w+)/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const map = { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 };
  return num * (map[unit] || 1);
}

function parseCpu(val) {
  if (!val) return 0;
  return parseFloat(val.replace("%", "")) || 0;
}

function fmtDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const COLUMNS = [
  { key: "name", label: "Name", minWidth: true },
  { key: "state", label: "Status" },
  { key: "cpuPerc", label: "CPU" },
  { key: "memUsage", label: "Memory" },
  { key: "memPerc", label: "Mem %" },
  { key: "netIO", label: "Net I/O" },
  { key: "blockIO", label: "Block I/O" },
  { key: "pids", label: "PIDs" },
  { key: "runningFor", label: "Age" },
];

export default function DockerPage() {
  const [containers, setContainers] = useState([]);
  const [host, setHost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [onlyRunning, setOnlyRunning] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [actionBusy, setActionBusy] = useState(new Set());
  const notify = useNotificationStore();

  const fetchContainers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/docker/containers");
      const data = await res.json();
      if (res.ok) {
        setContainers(data.containers || []);
        setHost(data.host);
        setError(null);
      } else {
        setError(data.error || "Failed to fetch containers");
      }
    } catch {
      setError("Docker not available");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchContainers(); }, [fetchContainers]);

  const filtered = useMemo(() => {
    let list = containers;
    if (onlyRunning) list = list.filter((c) => c.state === "running");
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
    }
    return list;
  }, [containers, onlyRunning, search]);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) => prev.size === filtered.length ? new Set() : new Set(filtered.map((c) => c.id)));
  };

  const selectedCount = selected.size;
  const allSelected = filtered.length > 0 && selectedCount === filtered.length;

  const runAction = async (id, action) => {
    setActionBusy((prev) => new Set(prev).add(`${id}:${action}`));
    try {
      const res = await fetch(`/api/docker/containers/${id}/${action}`, { method: "POST" });
      if (res.ok) {
        notify.success(`Container ${action}d`);
        await fetchContainers();
      } else {
        const data = await res.json();
        notify.error(data.error || `Failed to ${action} container`);
      }
    } catch {
      notify.error(`Failed to ${action} container`);
    } finally {
      setActionBusy((prev) => { const next = new Set(prev); next.delete(`${id}:${action}`); return next; });
    }
  };

  const totalCpu = useMemo(() => {
    if (!containers.length) return 0;
    return containers.reduce((sum, c) => sum + parseCpu(c.cpuPerc), 0);
  }, [containers]);

  const usedMem = useMemo(() => {
    if (!containers.length) return 0;
    return containers.reduce((sum, c) => {
      const parts = (c.memUsage || "").split("/");
      return sum + parseMem(parts[0]?.trim() || "");
    }, 0);
  }, [containers]);

  if (loading && containers.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-1 sm:gap-6 sm:px-0">
        <h1 className="text-xl font-semibold sm:text-2xl">Docker Containers</h1>
        <CardSkeleton />
      </div>
    );
  }

  if (error && containers.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-1 sm:gap-6 sm:px-0">
        <h1 className="text-xl font-semibold sm:text-2xl">Docker Containers</h1>
        <Card>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="material-symbols-outlined text-[48px] text-text-muted">warning</span>
            <p className="text-text-main font-medium">Docker is not available</p>
            <p className="text-sm text-text-muted max-w-xs">{error}</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-1 sm:gap-6 sm:px-0">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">Docker Containers</h1>
        <Button size="sm" variant="secondary" icon="refresh" onClick={fetchContainers} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {host && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card>
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-[24px] text-primary">memory</span>
              <div>
                <p className="text-xs text-text-muted">Container CPU usage</p>
                <p className="text-lg font-semibold font-mono">
                  {totalCpu.toFixed(2)}% / {host.ncpu ? `${host.ncpu * 100}%` : "—"}
                  {host.ncpu && <span className="text-xs text-text-muted font-normal ml-1">({host.ncpu} CPUs available)</span>}
                </p>
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-[24px] text-primary">storage</span>
              <div>
                <p className="text-xs text-text-muted">Container memory usage</p>
                <p className="text-lg font-semibold font-mono">
                  {fmtBytes(usedMem)} / {host.memTotal ? fmtBytes(host.memTotal) : "—"}
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}

      <Card>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-sm">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[18px] text-text-muted">
              search
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="w-full py-2 pl-9 pr-3 text-sm text-text-main bg-surface-2 rounded-[10px] border border-transparent placeholder-text-muted/70 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40 transition-all"
            />
          </div>
          <Toggle
            label="Only show running containers"
            checked={onlyRunning}
            onChange={setOnlyRunning}
            size="sm"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-text-main font-medium">No containers found</p>
            <p className="text-sm text-text-muted mt-1">
              {search ? "Try a different search query" : "No containers match the current filter"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-border-subtle text-xs text-text-muted">
                  <th className="py-2 pr-2 w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="size-4 rounded border-black/20 dark:border-white/20"
                    />
                  </th>
                  {COLUMNS.map((col) => (
                    <th key={col.key} className={cn("py-2 px-2 font-medium whitespace-nowrap", col.minWidth ? "min-w-[140px]" : "")}>
                      {col.label}
                    </th>
                  ))}
                  <th className="py-2 px-2 font-medium whitespace-nowrap w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const isRunning = c.state === "running";
                  const stopBusy = actionBusy.has(`${c.id}:stop`);
                  const startBusy = actionBusy.has(`${c.id}:start`);
                  const restartBusy = actionBusy.has(`${c.id}:restart`);
                  return (
                    <tr key={c.id} className="border-b border-border-subtle hover:bg-bg-hover transition-colors">
                      <td className="py-2 pr-2">
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggleSelect(c.id)}
                          className="size-4 rounded border-black/20 dark:border-white/20"
                        />
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-2">
                          <div className={cn(
                            "size-2 rounded-full shrink-0",
                            isRunning ? "bg-green-500" : c.state === "paused" ? "bg-amber-500" : "bg-text-muted/50"
                          )} />
                          <span className="font-medium truncate max-w-[160px] block">{c.name}</span>
                        </div>
                      </td>
                      <td className="py-2 px-2">
                        <Badge variant={isRunning ? "success" : c.state === "exited" ? "default" : "warning"} size="sm">
                          {c.state}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 font-mono text-xs">{c.cpuPerc || "—"}</td>
                      <td className="py-2 px-2 font-mono text-xs">{c.memUsage || "—"}</td>
                      <td className="py-2 px-2 font-mono text-xs">{c.memPerc || "—"}</td>
                      <td className="py-2 px-2 font-mono text-xs">{c.netIO || "—"}</td>
                      <td className="py-2 px-2 font-mono text-xs">{c.blockIO || "—"}</td>
                      <td className="py-2 px-2 font-mono text-xs">{c.pids || "—"}</td>
                      <td className="py-2 px-2 text-xs text-text-muted whitespace-nowrap">{c.runningFor || fmtDate(c.created)}</td>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-1">
                          {isRunning ? (
                            <button
                              onClick={() => runAction(c.id, "stop")}
                              disabled={stopBusy}
                              className="p-1.5 rounded hover:bg-red-500/10 text-red-500 disabled:opacity-40"
                              title="Stop"
                            >
                              <span className="material-symbols-outlined text-[16px]">
                                {stopBusy ? "progress_activity" : "stop"}
                              </span>
                            </button>
                          ) : (
                            <button
                              onClick={() => runAction(c.id, "start")}
                              disabled={startBusy}
                              className="p-1.5 rounded hover:bg-green-500/10 text-green-500 disabled:opacity-40"
                              title="Start"
                            >
                              <span className="material-symbols-outlined text-[16px]">
                                {startBusy ? "progress_activity" : "play_arrow"}
                              </span>
                            </button>
                          )}
                          <button
                            onClick={() => runAction(c.id, "restart")}
                            disabled={restartBusy}
                            className="p-1.5 rounded hover:bg-amber-500/10 text-amber-500 disabled:opacity-40"
                            title="Restart"
                          >
                            <span className="material-symbols-outlined text-[16px]">
                              {restartBusy ? "progress_activity" : "replay"}
                            </span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
