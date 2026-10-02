"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/shared/components";

const HARNESS_OPTIONS = ["opencode", "pi"];

const STATUS_STYLE = {
  running: "bg-emerald-500/15 text-emerald-500",
  done: "bg-sky-500/15 text-sky-500",
  failed: "bg-red-500/15 text-red-500",
  stopped: "bg-zinc-500/15 text-zinc-400",
  unknown: "bg-amber-500/15 text-amber-500",
};

function elapsed(startedAt) {
  if (!startedAt) return "-";
  const s = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}j ${m}m` : `${m}m ${s % 60}d`;
}

const inputCls =
  "bg-surface-2 border border-border-subtle rounded-md px-2 py-1.5 text-sm text-text-main w-full";

export default function AgentsPage() {
  const [config, setConfig] = useState(null);
  const [serverConfig, setServerConfig] = useState(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [logSlot, setLogSlot] = useState(null);
  const [logText, setLogText] = useState("");
  const [logSize, setLogSize] = useState("");
  const [logRotated, setLogRotated] = useState(false);
  const logSlotWanted = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/agents", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setConfig((prev) => prev ?? data.config);
      setServerConfig(data.config);
      setState(data.state);
      setError("");
    } catch (e) {
      setError(String(e?.message || e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const running = !!state?.slots?.some((s) => s.status === "running");
  // Polling tak berhenti saat idle (dulu berhenti begitu tak ada slot running ->
  // status launch baru tak pernah muncul tanpa reload manual). Interval 15 dtk
  // saat idle, 5 dtk saat ada yang jalan.
  useEffect(() => {
    const id = setInterval(refresh, running ? 5000 : 15000);
    return () => clearInterval(id);
  }, [running, refresh]);

  const post = async (url, body) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (data.state) setState(data.state);
      if (data.config) {
        setConfig(data.config);
        setServerConfig(data.config);
      }
      await refresh();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const showLog = async (n) => {
    setLogSlot(n);
    setLogText("memuat...");
    // Slot yang sedang diminta: respons log yang telat (slot lama) tak boleh
    // menimpa tampilan slot yang baru diklik.
    logSlotWanted.current = n;
    try {
      const res = await fetch(`/api/agents/log?slot=${n}`, { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || res.statusText);
      if (logSlotWanted.current !== n) return;
      setLogSize(d.size ? `${(d.size / 1024).toFixed(1)} KB` : "");
      setLogRotated(!!d.rotated);
      setLogText(
        d.log ||
          (d.rotated ? "(log aktif masih kosong; menampilkan arsip .prev)" : "(log kosong)"),
      );
    } catch (e) {
      if (logSlotWanted.current !== n) return;
      setLogSize("");
      setLogRotated(false);
      setLogText(String(e?.message || e));
    }
  };

  if (!config) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <Card padding="md">
          <div className="text-sm text-text-muted">{error || "Memuat..."}</div>
        </Card>
      </div>
    );
  }

  const patch = (p) => setConfig((c) => ({ ...c, ...p }));
  // Clamp di UI: input "9999" sempat render ribuan input slot sebelum server
  // menolak (sanitizeConfig clamp ke 5).
  const slotCount = Math.min(5, Math.max(1, Number(config.count) || 1));
  // Config lokal yang belum disimpan akan menimpa config server saat Launch.
  // Tandai lebih dulu daripada diam-diam menimpa (mis.diedit di tab lain/CLI).
  const dirty = !!serverConfig && JSON.stringify(serverConfig) !== JSON.stringify(config);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-text-main">Agents (headless)</h1>
          <p className="text-xs text-text-muted">
            Runner di dalam container 9router — harness: opencode / pi, status dari exit code + log.
            Auto-refresh 5 dtk saat ada slot jalan, 15 dtk saat idle.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="px-2 py-1 rounded-full bg-amber-500/15 text-amber-500 text-[11px] font-medium">
              config belum disimpan
            </span>
          )}
          <button
            disabled={busy}
            onClick={refresh}
            className="px-3 py-1.5 rounded-md bg-surface-2 border border-border-subtle text-sm text-text-main hover:bg-surface disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            disabled={busy}
            onClick={() => post("/api/agents", { config })}
            className="px-3 py-1.5 rounded-md bg-surface-2 border border-border-subtle text-sm text-text-main hover:bg-surface disabled:opacity-50"
          >
            Simpan
          </button>
          <button
            disabled={busy}
            onClick={() => post("/api/agents/launch", { config })}
            className="px-3 py-1.5 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            Launch {slotCount} agent
          </button>
          <button
            disabled={busy || !state?.slots?.length}
            onClick={() => post("/api/agents/stop", {})}
            className="px-3 py-1.5 rounded-md bg-red-500/15 text-red-500 text-sm font-medium hover:bg-red-500/25 disabled:opacity-50"
          >
            Stop semua
          </button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-xs text-red-400 break-words">
          {error}
        </div>
      )}

      <Card padding="md">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <label className="text-xs text-text-muted space-y-1">
            <div>Harness</div>
            <select
              value={config.harness}
              onChange={(e) => patch({ harness: e.target.value })}
              className={inputCls}
            >
              {HARNESS_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-text-muted space-y-1">
            <div>Jumlah agent (1-5)</div>
            <input
              type="number"
              min="1"
              max="5"
              value={slotCount}
              onChange={(e) => patch({ count: Math.min(5, Math.max(1, Number(e.target.value) || 1)) })}
              className={inputCls}
            />
          </label>
          <label className="text-xs text-text-muted space-y-1">
            <div>Task mode</div>
            <select
              value={config.taskMode}
              onChange={(e) => patch({ taskMode: e.target.value })}
              className={inputCls}
            >
              <option value="shared">Satu task bersama</option>
              <option value="slot">Textarea per slot</option>
            </select>
          </label>
          <label className="text-xs text-text-muted space-y-1 flex items-end gap-2 pb-1.5">
            <input
              type="checkbox"
              checked={!!config.loop}
              onChange={(e) => patch({ loop: e.target.checked })}
              className="size-4 accent-[var(--color-primary,#6366f1)]"
            />
            <span className="text-text-main">
              Loop terus <span className="text-text-muted">(5dtk sukses / 30dtk gagal)</span>
            </span>
          </label>
        </div>

        <div className="mt-3 space-y-2">
          <div className="text-xs text-text-muted">Model per slot (ulang pola bila jumlah &gt; slot)</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {Array.from({ length: slotCount }, (_, i) => (
              <input
                key={`m${i}`}
                value={config.models?.[i] ?? ""}
                onChange={(e) => {
                  const models = [...(config.models || [])];
                  models[i] = e.target.value;
                  patch({ models });
                }}
                placeholder={`model slot ${i + 1}`}
                className={inputCls}
              />
            ))}
          </div>
        </div>

        <div className="mt-3 space-y-2">
          <div className="text-xs text-text-muted">
            {config.taskMode === "shared" ? "Task (dipakai semua agent)" : "Task per slot"}
          </div>
          {config.taskMode === "shared" ? (
            <textarea
              value={config.task}
              onChange={(e) => patch({ task: e.target.value })}
              rows={4}
              placeholder="Contoh: Pantau folder /work/agent-* lalu ..."
              className={`${inputCls} font-mono text-xs`}
            />
          ) : (
            Array.from({ length: slotCount }, (_, i) => (
              <textarea
                key={`t${i}`}
                value={config.tasks?.[i] ?? ""}
                onChange={(e) => {
                  const tasks = [...(config.tasks || [])];
                  tasks[i] = e.target.value;
                  patch({ tasks });
                }}
                rows={2}
                placeholder={`Task slot ${i + 1}`}
                className={`${inputCls} font-mono text-xs`}
              />
            ))
          )}
        </div>
      </Card>

      <Card padding="md">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-text-main">Status slot</h2>
          <div className="text-xs text-text-muted">
            {state?.launchedAt ? (
              <>
                launch: {new Date(state.launchedAt).toLocaleString()}{" "}
                {state.loop ? "· loop ON" : "· sekali jalan"}
              </>
            ) : (
              "belum pernah launch"
            )}
          </div>
        </div>

        {!state?.slots?.length ? (
          <div className="text-xs text-text-muted">Belum ada run.</div>
        ) : (
          <div className="space-y-2">
            {state.slots.map((s) => (
              <div
                key={s.n}
                className="flex items-center gap-3 flex-wrap p-3 rounded-xl border border-border-subtle bg-surface-2"
              >
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                    STATUS_STYLE[s.status] || STATUS_STYLE.unknown
                  }`}
                >
                  {s.status}
                </span>
                <span className="text-sm text-text-main font-medium">Slot {s.n}</span>
                <span className="text-xs text-text-muted font-mono">{s.model}</span>
                <span className="text-xs text-text-muted">gen {s.gen}</span>
                <span className="text-xs text-text-muted">
                  exit {s.lastExit === null ? "-" : s.lastExit}
                </span>
                <span className="text-xs text-text-muted">{elapsed(s.startedAt)}</span>
                <span className="text-xs text-text-muted font-mono">pid {s.pid || "-"}</span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => showLog(s.n)}
                    className="px-2 py-1 rounded bg-surface border border-border-subtle text-[11px] text-text-main hover:bg-surface/80"
                  >
                    log
                  </button>
                  <button
                    disabled={busy || !s.alive}
                    onClick={() => post("/api/agents/stop", { slot: s.n })}
                    className="px-2 py-1 rounded bg-red-500/15 text-red-500 text-[11px] hover:bg-red-500/25 disabled:opacity-40"
                  >
                    stop
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {logSlot !== null && (
        <Card padding="md">
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-text-main">
              Log slot {logSlot} (tail)
              {logSize ? (
                <span className="ml-2 text-[11px] font-normal text-text-muted">
                  {logSize}
                  {logRotated ? " · arsip .prev (log aktif kosong/baru dirotasi)" : ""}
                </span>
              ) : null}
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => showLog(logSlot)}
                className="px-2 py-1 rounded bg-surface-2 border border-border-subtle text-[11px] text-text-main"
              >
                muat ulang
              </button>
              <button
                onClick={() => {
                  setLogSlot(null);
                  setLogSize("");
                  setLogRotated(false);
                }}
                className="px-2 py-1 rounded bg-surface-2 border border-border-subtle text-[11px] text-text-main"
              >
                tutup
              </button>
            </div>
          </div>
          <pre className="max-h-80 overflow-auto rounded-lg bg-black/60 text-[11px] text-emerald-300 p-3 whitespace-pre-wrap break-all">
            {logText}
          </pre>
        </Card>
      )}
    </div>
  );
}
