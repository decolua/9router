"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, CardSkeleton, ModelSelectModal, ConfirmModal } from "@/shared/components";

export default function ModelFallbacksPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeProviders, setActiveProviders] = useState([]);
  const [picker, setPicker] = useState(null); // { kind: "primary" | "fallback", editIndex: number | null }
  const [confirmState, setConfirmState] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [fbRes, providersRes] = await Promise.all([
        fetch("/api/model-fallbacks"),
        fetch("/api/providers"),
      ]);
      const fbData = fbRes.ok ? await fbRes.json() : { modelFallbacks: {} };
      const providersData = providersRes.ok ? await providersRes.json() : { connections: [] };
      const map = fbData.modelFallbacks || {};
      const list = Object.entries(map).map(([primary, v]) => ({
        primary,
        fallback: v.fallback,
        enabled: v.enabled !== false,
      }));
      setRows(list);
      setActiveProviders(providersData.connections || []);
    } catch (e) {
      console.log("Error fetching model fallbacks:", e);
    } finally {
      setLoading(false);
    }
  };

  const persist = async (nextRows) => {
    const map = {};
    for (const r of nextRows) {
      if (!r.primary || !r.fallback) continue;
      map[r.primary] = {
        fallback: r.fallback,
        enabled: r.enabled !== false,
        updatedAt: new Date().toISOString(),
      };
    }
    try {
      await fetch("/api/model-fallbacks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelFallbacks: map }),
      });
      setRows(nextRows);
    } catch (e) {
      console.log("Error persisting model fallbacks:", e);
    }
  };

  const handlePick = (modelStr) => {
    if (!picker) return;
    const { kind, editIndex } = picker;

    if (kind === "primary" && editIndex === null) {
      // Adding new row: check duplicate
      if (rows.some((r) => r.primary === modelStr)) {
        setError(`A fallback for "${modelStr}" already exists.`);
        setPicker(null);
        return;
      }
      // Store primary pending; open fallback picker next
      setPicker({ kind: "fallback", pendingPrimary: modelStr });
      return;
    }

    if (kind === "fallback" && editIndex === null) {
      const primary = picker.pendingPrimary;
      if (modelStr === primary) {
        setError("Fallback model must differ from primary.");
        setPicker(null);
        return;
      }
      const next = [...rows, { primary, fallback: modelStr, enabled: true }];
      persist(next);
      setError("");
      setPicker(null);
      return;
    }

    // Editing existing row's field
    const next = rows.map((r, i) => {
      if (i !== editIndex) return r;
      if (kind === "primary") {
        if (rows.some((rr, ii) => ii !== i && rr.primary === modelStr)) {
          setError(`A fallback for "${modelStr}" already exists.`);
          return r;
        }
        return { ...r, primary: modelStr };
      }
      if (kind === "fallback") {
        if (modelStr === r.primary) {
          setError("Fallback model must differ from primary.");
          return r;
        }
        return { ...r, fallback: modelStr };
      }
      return r;
    });
    persist(next);
    setError("");
    setPicker(null);
  };

  const toggleEnabled = (idx) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, enabled: !r.enabled } : r));
    persist(next);
  };

  const removeRow = (idx) => {
    setConfirmState({
      title: "Remove Fallback",
      message: `Remove fallback for "${rows[idx].primary}"?`,
      onConfirm: () => {
        const next = rows.filter((_, i) => i !== idx);
        persist(next);
        setConfirmState(null);
      },
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-text-main">Model Fallbacks</h2>
          <p className="text-sm text-text-muted mt-1">
            When a primary model fails (quota / rate-limit / transient), retry once against a fallback model.
          </p>
        </div>
        <Button onClick={() => setPicker({ kind: "primary", editIndex: null })}>
          <span className="material-symbols-outlined text-[18px] mr-1">add</span>
          Add Fallback
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <Card className="p-8 flex flex-col items-center gap-3 text-center">
          <span className="material-symbols-outlined text-[40px] text-text-muted">sync_alt</span>
          <p className="text-text-muted">No fallbacks yet</p>
          <Button onClick={() => setPicker({ kind: "primary", editIndex: null })}>Create one</Button>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <Card key={r.primary} className="p-4 flex items-center gap-3">
              <button
                onClick={() => setPicker({ kind: "primary", editIndex: i })}
                className="flex-1 min-w-0 text-left px-3 py-2 rounded-lg bg-surface-2 hover:bg-surface-3 transition-colors"
                title="Change primary"
              >
                <div className="text-[11px] uppercase tracking-wider text-text-muted">Primary</div>
                <div className="text-sm font-medium text-text-main truncate">{r.primary}</div>
              </button>
              <span className="material-symbols-outlined text-text-muted">arrow_forward</span>
              <button
                onClick={() => setPicker({ kind: "fallback", editIndex: i })}
                className="flex-1 min-w-0 text-left px-3 py-2 rounded-lg bg-surface-2 hover:bg-surface-3 transition-colors"
                title="Change fallback"
              >
                <div className="text-[11px] uppercase tracking-wider text-text-muted">Fallback</div>
                <div className="text-sm font-medium text-text-main truncate">{r.fallback}</div>
              </button>
              <button
                onClick={() => toggleEnabled(i)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  r.enabled
                    ? "bg-green-600/15 text-green-700 dark:text-green-400"
                    : "bg-surface-3 text-text-muted"
                }`}
              >
                {r.enabled ? "Enabled" : "Disabled"}
              </button>
              <button
                onClick={() => removeRow(i)}
                className="p-1.5 rounded-lg text-text-muted hover:bg-red-500/10 hover:text-red-500 transition-colors"
                title="Remove"
              >
                <span className="material-symbols-outlined text-[20px]">delete</span>
              </button>
            </Card>
          ))}
        </div>
      )}

      {picker && (
        <ModelSelectModal
          isOpen={true}
          activeProviders={activeProviders}
          onClose={() => setPicker(null)}
          onSelect={handlePick}
        />
      )}

      {confirmState && (
        <ConfirmModal
          isOpen={true}
          title={confirmState.title}
          message={confirmState.message}
          onConfirm={confirmState.onConfirm}
          onClose={() => setConfirmState(null)}
        />
      )}
    </div>
  );
}
