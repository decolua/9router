"use client";

import { useState, useEffect, useRef } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Drawer from "@/shared/components/Drawer";
import Badge from "@/shared/components/Badge";
import { cn } from "@/shared/utils/cn";

function StatusDot({ status }) {
  const ok = !status || status === "ok" || status === "success";
  return (
    <span
      className={cn(
        "block size-1.5 rounded-full",
        ok ? "bg-success animate-pulse" : "bg-error"
      )}
      title={status || "ok"}
    />
  );
}

function StatusBadge({ status }) {
  const ok = !status || status === "ok" || status === "success";
  return (
    <Badge variant={ok ? "success" : "error"} size="sm" dot>
      {status || "ok"}
    </Badge>
  );
}

function tokenCount(tokens) {
  const t = tokens || {};
  return (t.prompt_tokens || t.input_tokens || 0) + (t.completion_tokens || t.output_tokens || 0);
}

function TimeAgo({ timestamp }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(timer);
  }, []);
  const diff = Math.max(0, Math.floor((Date.now() - new Date(timestamp)) / 1000));
  if (diff < 60) return <>{diff}s ago</>;
  if (diff < 3600) return <>{Math.floor(diff / 60)}m ago</>;
  if (diff < 86400) return <>{Math.floor(diff / 3600)}h ago</>;
  return <>{Math.floor(diff / 86400)}d ago</>;
}

export default function LiveRequestInspectorTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const pausedRef = useRef(false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    let es = null;
    let retryTimer = null;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      es = new EventSource("/api/usage/live-requests");
      es.onmessage = (e) => {
        if (pausedRef.current) return;
        try {
          const data = JSON.parse(e.data);
          if (data._type === "snapshot" && Array.isArray(data.rows)) {
            setRows(data.rows);
            setConnected(true);
          }
          setLoading(false);
        } catch {
        }
      };
      es.onerror = () => {
        setConnected(false);
        setLoading(false);
        es.close();
        retryTimer = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (es) es.close();
    };
  }, []);

  const handleView = (row) => {
    setSelected(row);
    setIsDrawerOpen(true);
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card padding="sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "block size-2 rounded-full",
                connected && !paused ? "bg-success animate-pulse" : "bg-surface-3"
              )}
            />
            <span className="text-sm font-medium text-text-main">
              {paused ? "Paused" : connected ? "Live" : "Connecting"}
            </span>
            <span className="text-xs text-text-muted">
              Newest {rows.length} requests, updating as they arrive
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPaused((v) => !v)}
          >
            {paused ? "Resume" : "Pause"}
          </Button>
        </div>
      </Card>

      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-black/5 dark:border-white/5">
                <th className="p-4 text-left text-sm font-semibold text-text-main w-8" aria-label="Status" />
                <th className="p-4 text-left text-sm font-semibold text-text-main">Model</th>
                <th className="p-4 text-left text-sm font-semibold text-text-main">Provider</th>
                <th className="p-4 text-right text-sm font-semibold text-text-main">Tokens</th>
                <th className="p-4 text-left text-sm font-semibold text-text-main">Latency</th>
                <th className="p-4 text-right text-sm font-semibold text-text-main">Received</th>
                <th className="p-4 text-center text-sm font-semibold text-text-main">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" className="p-8 text-center text-text-muted">
                    <div className="flex items-center justify-center gap-2">
                      <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
                      Connecting to live stream...
                    </div>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan="7" className="p-8 text-center text-text-muted">
                    No requests yet. Send a request through the proxy and it appears here in real time.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-black/5 dark:border-white/5 last:border-b-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="p-4">
                      <StatusDot status={row.status} />
                    </td>
                    <td className="max-w-[260px] truncate p-4 font-mono text-sm text-text-main" title={row.model}>
                      {row.model || "unknown"}
                      {row.resolvedModel && row.resolvedModel !== row.model && (
                        <div className="truncate text-xs text-text-muted" title={row.resolvedModel}>
                          via {row.resolvedModel}
                        </div>
                      )}
                    </td>
                    <td className="max-w-[180px] truncate p-4 text-sm text-text-main">
                      {row.provider || "unknown"}
                    </td>
                    <td className="p-4 text-right font-mono text-sm text-text-main">
                      {tokenCount(row.tokens).toLocaleString()}
                    </td>
                    <td className="p-4 text-sm text-text-muted">
                      <span className="font-mono">{row.latency?.total || 0}ms</span>
                    </td>
                    <td className="p-4 text-right text-sm text-text-muted whitespace-nowrap">
                      <TimeAgo timestamp={row.timestamp} />
                    </td>
                    <td className="p-4 text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleView(row)}
                      >
                        Detail
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="Request Details"
        width="lg"
      >
        {selected && (
          <div className="space-y-6">
            <div className="grid min-w-0 grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <span className="text-text-muted">ID:</span>{" "}
                <span className="break-all font-mono text-text-main">{selected.id}</span>
              </div>
              <div>
                <span className="text-text-muted">Timestamp:</span>{" "}
                <span className="text-text-main">{new Date(selected.timestamp).toLocaleString()}</span>
              </div>
              <div>
                <span className="text-text-muted">Provider:</span>{" "}
                <span className="text-text-main font-medium">{selected.provider || "unknown"}</span>
              </div>
              <div>
                <span className="text-text-muted">Model:</span>{" "}
                <span className="text-text-main font-mono">{selected.model || "unknown"}</span>
              </div>
              {selected.resolvedModel && selected.resolvedModel !== selected.model && (
                <div>
                  <span className="text-text-muted">Served by:</span>{" "}
                  <span className="text-text-main font-mono">{selected.resolvedModel}</span>
                </div>
              )}
              <div>
                <span className="text-text-muted">Status:</span>{" "}
                <StatusBadge status={selected.status} />
              </div>
              <div>
                <span className="text-text-muted">Latency:</span>{" "}
                <span className="text-text-main font-mono">
                  TTFT {selected.latency?.ttft || 0}ms / Total {selected.latency?.total || 0}ms
                </span>
              </div>
              <div>
                <span className="text-text-muted">Input Tokens:</span>{" "}
                <span className="text-text-main font-mono">
                  {((selected.tokens?.prompt_tokens || selected.tokens?.input_tokens || 0)).toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-text-muted">Output Tokens:</span>{" "}
                <span className="text-text-main font-mono">
                  {((selected.tokens?.completion_tokens || selected.tokens?.output_tokens || 0)).toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-text-muted">Total Tokens:</span>{" "}
                <span className="text-text-main font-mono">
                  {tokenCount(selected.tokens).toLocaleString()}
                </span>
              </div>
              {selected.pxpipe && (
                <div>
                  <span className="text-text-muted">PXPIPE:</span>{" "}
                  <span className="text-text-main font-mono">
                    {selected.pxpipe.applied ? `Applied, saved ${selected.pxpipe.savedPct || 0}%` : `Skipped (${selected.pxpipe.reason || "n/a"})`}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
