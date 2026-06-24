"use client";

import { useState, useEffect } from "react";
import type { ComponentType, ReactNode, ButtonHTMLAttributes } from "react";
import {
  Card as _Card,
  Button as _Button,
  CardSkeleton,
  ModelSelectModal as _ModelSelectModal,
  ConfirmModal as _ConfirmModal,
} from "@/shared/components";
import type { JsonValue } from "open-sse/types/executor.js";

// ---------------------------------------------------------------------------
// Typed shims — JS shared components lack TS declarations
// ---------------------------------------------------------------------------
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
  variant?: string;
  size?: string;
  icon?: string;
  iconRight?: string;
  loading?: boolean;
  fullWidth?: boolean;
}
interface CardProps {
  children?: ReactNode;
  title?: string;
  subtitle?: string;
  icon?: string;
  action?: ReactNode;
  padding?: string;
  hover?: boolean;
  elev?: boolean;
  className?: string;
}
interface ConfirmModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  onConfirm?: (() => void | Promise<void>) | undefined;
  title?: string;
  message?: string | undefined;
  confirmText?: string;
  cancelText?: string;
  variant?: string;
  loading?: boolean;
}
interface ModelPickItem {
  value: string;
  name?: string;
  [key: string]: JsonValue | undefined;
}
interface Connection {
  id?: string;
  name?: string;
  [key: string]: JsonValue | undefined;
}
interface ModelSelectModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  onSelect?: (model: ModelPickItem) => void;
  activeProviders?: Connection[];
  title?: string;
  closeOnSelect?: boolean;
}

const Button           = _Button           as ComponentType<ButtonProps>;
const Card             = _Card             as ComponentType<CardProps>;
const ConfirmModal     = _ConfirmModal     as ComponentType<ConfirmModalProps>;
const ModelSelectModal = _ModelSelectModal as ComponentType<ModelSelectModalProps>;

// ---------------------------------------------------------------------------
// JsonValue helpers
// ---------------------------------------------------------------------------
async function asJson(res: Response): Promise<JsonValue> {
  return res.json() as Promise<JsonValue>;
}
function strOf(v: JsonValue | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function recOf(v: JsonValue): Record<string, JsonValue> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, JsonValue>)
    : {};
}
function arrOf(v: JsonValue): JsonValue[] {
  return Array.isArray(v) ? v : [];
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------
type FallbackStrategy = "ordered" | "random" | "roundrobin";

interface FallbackRow {
  primary: string;
  fallbacks: string[];
  strategy: FallbackStrategy;
  enabled: boolean;
}

interface EditorState {
  action: "create" | "edit";
  primary: string;
  fallbacks: string[];
  strategy: FallbackStrategy;
  enabled: boolean;
  originalPrimary: string;
}

interface ConfirmStateItem {
  title: string;
  message: string;
  onConfirm: () => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STRATEGY_OPTIONS: Array<{ id: FallbackStrategy; label: string; desc: string }> = [
  { id: "ordered",    label: "Ordered",    desc: "Try fallbacks top-to-bottom" },
  { id: "random",     label: "Random",     desc: "Shuffle order each request" },
  { id: "roundrobin", label: "Round-robin", desc: "Rotate starting fallback each request" },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function ModelFallbacksPage() {
  const [rows, setRows] = useState<FallbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeProviders, setActiveProviders] = useState<Connection[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [picker, setPicker] = useState<"primary" | "fallback" | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmStateItem | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.resolve().then(async () => {
      try {
        const [fbRes, providersRes] = await Promise.all([
          fetch("/api/model-fallbacks"),
          fetch("/api/providers"),
        ]);
        const fbRaw = fbRes.ok ? recOf(await asJson(fbRes)) : {};
        const provRaw = providersRes.ok ? recOf(await asJson(providersRes)) : {};
        const map = fbRaw["modelFallbacks"];
        const mapRec = map && typeof map === "object" && !Array.isArray(map)
          ? (map as Record<string, JsonValue>)
          : {};
        const list: FallbackRow[] = Object.entries(mapRec).map(([primary, v]) => {
          const rv = recOf(v as JsonValue);
          const fallbacksArr = arrOf(rv["fallbacks"] ?? []);
          const fallbacks = fallbacksArr.length > 0
            ? fallbacksArr.map((f) => strOf(f as JsonValue) ?? "").filter(Boolean)
            : (strOf(rv["fallback"]) ? [strOf(rv["fallback"]) as string] : []);
          const rawStrategy = strOf(rv["strategy"]) ?? strOf(rv["mode"]) ?? "ordered";
          const strategy: FallbackStrategy =
            rawStrategy === "random" || rawStrategy === "roundrobin" ? rawStrategy : "ordered";
          return {
            primary,
            fallbacks,
            strategy,
            enabled: rv["enabled"] !== false,
          };
        });
        setRows(list);
        setActiveProviders(arrOf(provRaw["connections"] ?? []) as Connection[]);
      } catch (e) {
        console.log("Error fetching model fallbacks:", e);
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const persistAll = async (nextRows: FallbackRow[]) => {
    const map: Record<string, JsonValue> = {};
    for (const r of nextRows) {
      if (!r.primary || !Array.isArray(r.fallbacks) || r.fallbacks.length === 0) continue;
      map[r.primary] = {
        fallbacks: r.fallbacks,
        strategy: r.strategy ?? "ordered",
        mode: r.strategy ?? "ordered", // back-compat for old engine/client code reading `mode`
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

  const handlePick = (model: ModelPickItem) => {
    const modelStr = typeof model === "string" ? model : (model?.value ?? model?.name ?? "");
    if (!modelStr || !picker || !editor) return;

    if (picker === "primary") {
      const dupe = rows.some((r) => r.primary === modelStr && r.primary !== editor.originalPrimary);
      if (dupe) { setError(`A fallback for "${modelStr}" already exists.`); return; }
      setEditor({ ...editor, primary: modelStr });
      setError("");
      setPicker(null);
      return;
    }

    if (modelStr === editor.primary) { setError("Fallback model must differ from primary."); return; }
    if (editor.fallbacks.includes(modelStr)) { setError(`"${modelStr}" already in fallback list.`); return; }
    setEditor({ ...editor, fallbacks: [...editor.fallbacks, modelStr] });
    setError("");
  };

  const handleSaveEditor = () => {
    if (!editor) return;
    if (!editor.primary) { setError("Pick a primary model."); return; }
    if (editor.fallbacks.length === 0) { setError("Add at least one fallback model."); return; }
    const newRow: FallbackRow = {
      primary: editor.primary,
      fallbacks: editor.fallbacks,
      strategy: editor.strategy ?? "ordered",
      enabled: editor.enabled !== false,
    };
    if (editor.action === "create") {
      persistAll([...rows.filter((r) => r.primary !== editor.originalPrimary), newRow]);
    } else {
      persistAll(rows.map((r) => (r.primary === editor.originalPrimary ? newRow : r)));
    }
    setEditor(null);
    setError("");
  };

  const handleCancelEditor = () => { setEditor(null); setError(""); };

  const moveFallback = (idx: number, dir: number) => {
    if (!editor) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= editor.fallbacks.length) return;
    const next = [...editor.fallbacks];
    [next[idx], next[newIdx]] = [next[newIdx] as string, next[idx] as string];
    setEditor({ ...editor, fallbacks: next });
  };

  const removeFallback = (idx: number) => {
    if (!editor) return;
    setEditor({ ...editor, fallbacks: editor.fallbacks.filter((_, i) => i !== idx) });
  };

  const toggleRowEnabled = (primary: string) => {
    persistAll(rows.map((r) => (r.primary === primary ? { ...r, enabled: !r.enabled } : r)));
  };

  const removeRow = (primary: string) => {
    setConfirmState({
      title: "Remove fallback entry?",
      message: `Remove "${primary}" and all its fallbacks?`,
      onConfirm: () => {
        persistAll(rows.filter((r) => r.primary !== primary));
        setConfirmState(null);
      },
    });
  };

  const openCreate = () => {
    setError("");
    setEditor({ action: "create", primary: "", fallbacks: [], strategy: "ordered", enabled: true, originalPrimary: "" });
    setPicker("primary");
  };

  const openEdit = (r: FallbackRow) => {
    setError("");
    setEditor({
      action: "edit",
      primary: r.primary,
      fallbacks: [...r.fallbacks],
      strategy: r.strategy ?? "ordered",
      enabled: r.enabled,
      originalPrimary: r.primary,
    });
    setPicker(null);
  };

  if (loading) {
    return (
      <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
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
            When a primary model fails (quota / rate-limit / transient), retry against each fallback until one succeeds.
          </p>
        </div>
        <Button onClick={openCreate} icon="add">Add Fallback</Button>
      </div>

      {rows.length === 0 ? (
        <Card className="p-8 flex flex-col items-center gap-3 text-center">
          <span className="material-symbols-outlined text-[40px] text-text-muted">sync_alt</span>
          <p className="text-text-muted">No fallbacks yet</p>
          <Button onClick={openCreate}>Create one</Button>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <Card key={r.primary} className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-surface-2">
                  <div className="text-[11px] uppercase tracking-wider text-text-muted">Primary</div>
                  <div className="text-sm font-medium text-text-main truncate">{r.primary}</div>
                </div>
                <span className="text-xs px-2 py-1 rounded bg-primary/10 text-primary">{r.strategy ?? "ordered"}</span>
                <button
                  onClick={() => toggleRowEnabled(r.primary)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    r.enabled
                      ? "bg-green-600/15 text-green-700 dark:text-green-400"
                      : "bg-surface-3 text-text-muted"
                  }`}
                >
                  {r.enabled ? "Enabled" : "Disabled"}
                </button>
                <button
                  onClick={() => removeRow(r.primary)}
                  className="p-1.5 rounded-lg text-text-muted hover:bg-red-500/10 hover:text-red-500 transition-colors"
                  title="Remove"
                >
                  <span className="material-symbols-outlined text-[20px]">delete</span>
                </button>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] uppercase tracking-wider text-text-muted">Fallbacks (try order)</span>
                <button
                  onClick={() => openEdit(r)}
                  className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  Edit
                </button>
              </div>
              {r.fallbacks.length === 0 ? (
                <p className="text-xs text-text-muted">No fallbacks configured.</p>
              ) : (
                <ol className="flex flex-col gap-1">
                  {r.fallbacks.map((fb, j) => (
                    <li key={`${fb}-${j}`} className="flex items-center gap-2 text-sm">
                      <span className="text-text-muted text-xs w-5">{j + 1}.</span>
                      <code className="text-xs px-2 py-1 rounded bg-surface-2 flex-1">{fb}</code>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          ))}
        </div>
      )}

      {editor && (
        <EditorModal
          editor={editor}
          error={error}
          onChange={(patch) => setEditor({ ...editor, ...patch })}
          onPickPrimary={() => setPicker("primary")}
          onAddFallback={() => setPicker("fallback")}
          onMoveFallback={moveFallback}
          onRemoveFallback={removeFallback}
          onSave={handleSaveEditor}
          onCancel={handleCancelEditor}
          strategyOptions={STRATEGY_OPTIONS}
        />
      )}

      {picker && editor && (
        <ModelSelectModal
          isOpen={true}
          title={picker === "primary" ? "Pick primary model" : "Pick fallback model (click as many as you want; Close when done)"}
          activeProviders={activeProviders}
          onClose={() => setPicker(null)}
          onSelect={handlePick}
          closeOnSelect={picker === "primary"}
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

// ---------------------------------------------------------------------------
// EditorModal
// ---------------------------------------------------------------------------
interface EditorModalProps {
  editor: EditorState;
  error: string;
  onChange: (patch: Partial<EditorState>) => void;
  onPickPrimary: () => void;
  onAddFallback: () => void;
  onMoveFallback: (idx: number, dir: number) => void;
  onRemoveFallback: (idx: number) => void;
  onSave: () => void;
  onCancel: () => void;
  strategyOptions: Array<{ id: FallbackStrategy; label: string; desc: string }>;
}

function EditorModal({ editor, error, onChange, onPickPrimary, onAddFallback, onMoveFallback, onRemoveFallback, onSave, onCancel, strategyOptions }: EditorModalProps) {
  const isEdit = editor.action === "edit";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-xl bg-surface-1 border border-border-subtle shadow-xl flex flex-col max-h-[90vh]">
        <div className="px-6 pt-5 pb-3 border-b border-border-subtle flex items-center justify-between">
          <h3 className="text-lg font-semibold text-text-main">
            {isEdit ? "Edit fallback" : "New fallback"}
          </h3>
          <button onClick={onCancel} className="p-1 rounded hover:bg-surface-2 text-text-muted">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {error && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              {error}
            </div>
          )}

          {/* Primary */}
          <div>
            <div className="text-[11px] uppercase tracking-wider text-text-muted mb-1">Primary model</div>
            <div className="flex items-center gap-2">
              <button
                onClick={isEdit ? undefined : onPickPrimary}
                disabled={isEdit}
                className={`flex-1 text-left px-3 py-2 rounded-lg bg-surface-2 transition-colors ${
                  isEdit ? "opacity-60 cursor-not-allowed" : "hover:bg-surface-3 cursor-pointer"
                }`}
              >
                <code className="text-sm">
                  {editor.primary || (isEdit ? "" : "— pick primary model —")}
                </code>
              </button>
              {!isEdit && (
                <Button variant="outline" icon="edit" onClick={onPickPrimary}>Change</Button>
              )}
            </div>
            {isEdit && <p className="text-xs text-text-muted mt-1">Primary is locked on edit.</p>}
          </div>

          {/* Fallbacks */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] uppercase tracking-wider text-text-muted">
                Fallback models ({editor.fallbacks.length})
              </div>
              <button
                onClick={onAddFallback}
                disabled={!editor.primary}
                className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40"
              >
                + Add
              </button>
            </div>
            {editor.fallbacks.length === 0 ? (
              <p className="text-xs text-text-muted">No fallbacks yet — click &quot;+ Add&quot; to pick models.</p>
            ) : (
              <ol className="flex flex-col gap-1">
                {editor.fallbacks.map((fb, j) => (
                  <li key={`${fb}-${j}`} className="flex items-center gap-2 text-sm">
                    <span className="text-text-muted text-xs w-5">{j + 1}.</span>
                    <code className="text-xs px-2 py-1 rounded bg-surface-2 flex-1">{fb}</code>
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => onMoveFallback(j, -1)}
                        disabled={j === 0}
                        className="p-1 rounded hover:bg-surface-3 text-text-muted disabled:opacity-30"
                        title="Move up"
                      >
                        <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                      </button>
                      <button
                        onClick={() => onMoveFallback(j, 1)}
                        disabled={j === editor.fallbacks.length - 1}
                        className="p-1 rounded hover:bg-surface-3 text-text-muted disabled:opacity-30"
                        title="Move down"
                      >
                        <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
                      </button>
                      <button
                        onClick={() => onRemoveFallback(j)}
                        className="p-1 rounded text-text-muted hover:bg-red-500/10 hover:text-red-500 transition-colors"
                        title="Remove"
                      >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Strategy selector */}
          <div>
            <div className="text-[11px] uppercase tracking-wider text-text-muted mb-1">Strategy</div>
            <div className="flex flex-col gap-1">
              {strategyOptions.map((opt) => (
                <label
                  key={opt.id}
                  className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                    editor.strategy === opt.id ? "bg-primary/10" : "hover:bg-surface-2"
                  }`}
                >
                  <input
                    type="radio"
                    name="fb-strategy"
                    checked={editor.strategy === opt.id}
                    onChange={() => onChange({ strategy: opt.id })}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{opt.label}</div>
                    <div className="text-xs text-text-muted">{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Enabled */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={editor.enabled !== false}
              onChange={(e) => onChange({ enabled: e.target.checked })}
              className="h-4 w-4 rounded border-border"
            />
            <span>Enabled</span>
          </label>
        </div>

        <div className="px-6 py-4 border-t border-border-subtle flex gap-2 justify-end">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button
            onClick={onSave}
            disabled={!editor.primary || editor.fallbacks.length === 0}
            icon="save"
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
