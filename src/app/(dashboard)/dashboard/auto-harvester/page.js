"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Input, PageShell } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

const LOOP_OPTIONS = [
  { value: 0, label: "Once (no loop)" },
  { value: 2, label: "Every 2m (aggressive)" },
  { value: 5, label: "Every 5m" },
  { value: 15, label: "Every 15m" },
  { value: 30, label: "Every 30m" },
  { value: 60, label: "Every 60m" },
];

function formatTime(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function AutoHarvesterPage() {
  const [status, setStatus] = useState(null);
  const [target, setTarget] = useState(5);
  const [loop, setLoop] = useState(0);
  const [busy, setBusy] = useState(false);
  const timerRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/harvester");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    timerRef.current = setInterval(refresh, 2500);
    return () => clearInterval(timerRef.current);
  }, [refresh]);

  const send = async (payload) => {
    setBusy(true);
    try {
      const res = await fetch("/api/harvester", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setStatus((prev) => ({ ...prev, ...data }));
      }
    } catch {}
    finally {
      setBusy(false);
    }
  };

  const start = () => send({ action: "start", target: Number(target) || 5, loopMinutes: Number(loop) || 0 });
  const stop = () => send({ action: "stop" });

  const running = status?.running;
  const lastAdded = status?.lastAdded ?? 0;
  const lastTested = status?.lastTested ?? 0;
  const targetCount = status?.targetCount ?? target;
  const progress = targetCount > 0 ? Math.min(100, Math.round((lastAdded / targetCount) * 100)) : 0;

  return (
    <PageShell width="reading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold sm:text-2xl">Auto Harvester</h1>
            <Badge variant="warning">FEATURE+</Badge>
          </div>
          <p className="text-sm text-text-muted mt-1">
            Auto-fills your proxy pool from 12 public free-proxy feeds.
          </p>
        </div>
        <Badge variant={running ? "success" : "default"} className="shrink-0">
          {running ? "Running" : "Idle"}
        </Badge>
      </div>

      {/*__PART2__*/}

      <div className="grid grid-cols-2 gap-3 mt-3 sm:grid-cols-4">
        <Card className="p-3">
          <div className="text-[11px] uppercase tracking-wider text-text-muted">Tested</div>
          <div className="text-xl font-semibold mt-1 tabular-nums">{lastTested}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] uppercase tracking-wider text-text-muted">Live imported</div>
          <div className="text-xl font-semibold mt-1 tabular-nums text-emerald-400">{lastAdded}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] uppercase tracking-wider text-text-muted">Target</div>
          <div className="text-xl font-semibold mt-1 tabular-nums">{targetCount}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] uppercase tracking-wider text-text-muted">Loop</div>
          <div className="text-xl font-semibold mt-1">
            {status?.loopIntervalMinutes > 0 ? `every ${status.loopIntervalMinutes}m` : "once"}
          </div>
        </Card>
      </div>

      <Card className="p-4 mt-3">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-text-muted">Progress toward target</span>
          <span className="font-semibold tabular-nums">{progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", running ? "bg-emerald-500" : "bg-primary")}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-muted">Target live proxies</label>
              <Input
                type="number"
                min={1}
                max={200}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                disabled={running}
                className="w-28"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-muted">Loop interval</label>
              <select
                value={loop}
                onChange={(e) => setLoop(Number(e.target.value))}
                disabled={running}
                className="h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface text-sm text-text-main disabled:opacity-40"
              >
                {LOOP_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {running ? (
            <Button variant="danger" icon="stop_circle" onClick={stop} loading={busy}>
              Stop
            </Button>
          ) : (
            <Button icon="radar" onClick={start} loading={busy}>
              Start Harvest
            </Button>
          )}
        </div>
      </Card>

      {/*__PART3__*/}

      <Card className="p-4 mt-3">
        <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2">Live status</div>
        <p className="text-sm whitespace-pre-wrap break-words">
          {status?.lastMessage || "Waiting for harvester status..."}
        </p>
      </Card>

      <Card className="p-4 mt-3">
        <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2">Cycle history</div>
        {status?.history?.length ? (
          <div className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
            {status.history.map((h, i) => (
              <div key={i} className="flex items-center justify-between py-2 text-sm">
                <span className="text-text-muted tabular-nums">{formatTime(h.at)}</span>
                <span>
                  <span className="text-emerald-400 font-semibold tabular-nums">+{h.added}</span>
                  <span className="text-text-muted"> / {h.tested} tested</span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            No runs yet. Press <span className="text-text-main">Start Harvest</span> to begin.
          </p>
        )}
      </Card>
    </PageShell>
  );
}