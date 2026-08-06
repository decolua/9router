"use client";

import { useState, useEffect } from "react";
import { Button, Select, Input, SegmentedControl, Toggle } from "@/shared/components";
import Modal from "@/shared/components/Modal";
import { cn } from "@/shared/utils/cn";
import { AI_PROVIDERS } from "@/shared/constants/config";
import { ruleToRow, rowToRule, mergeProviderOptions } from "./skipRulesLogic.js";

// Suggested error codes for the datalist (from open-sse errorConfig status map).
const SUGGESTED_STATUSES = [400, 401, 402, 403, 404, 406, 408, 429, 500, 502, 503, 504];

// How to match: an HTTP failure (status and/or body text) or a transport error kind.
const MATCH_MODES = [
  { value: "http", label: "HTTP" },
  { value: "kind", label: "Transport" },
];

const KIND_OPTIONS = [
  { value: "connect_timeout", label: "connect_timeout" },
  { value: "network", label: "network" },
];

// Short labels so the two segments never clip inside the control.
const ACTION_OPTIONS = [
  { value: "skip", label: "Skip" },
  { value: "retry", label: "Retry" },
];

// Turn the shared Input/Select into a *real* field on the card. The shared
// components hardcode `bg-surface-2 border-transparent rounded-[10px] py-2.5`
// and cn() is a plain string-join (NOT tailwind-merge), so overriding those
// exact props needs `!` to win. Only the overridden props carry `!`:
//   bg-surface-2 → !bg-bg   (bg-bg = var(--color-bg), the real contrasting token;
//                            `bg-background` does NOT exist in this theme)
//   border-transparent → !border-border   (resting border)
//   rounded-[10px] → !rounded-lg           (app-standard radius)
//   py-2.5 → !py-0 + h-10                  (fixed 40px height; h-10 not set by
//                                           the component so it needs no `!`)
// hover carries `!` because it must beat the `!border-border` base on hover.
// Focus ring is already provided by the shared component (focus:ring-2).
const FIELD_CLS = "h-10 !py-0 !bg-bg !border-border !rounded-lg hover:!border-brand-500/60";

// Small fixed label above each field (12px), so placeholders aren't the only label.
function Field({ label, children, className }) {
  return (
    <div className={cn("flex flex-col gap-1 min-w-0", className)}>
      {label && <span className="text-xs text-text-muted leading-none">{label}</span>}
      {children}
    </div>
  );
}

function emptyRule() {
  return { provider: "", matchMode: "http", status: "", contains: "", kind: "connect_timeout", action: "skip", headerTimeoutMs: "", sweep: false };
}

export default function SkipRulesModal({ open, onClose, onSaved }) {
  const [rows, setRows] = useState([]);
  const [providerOpts, setProviderOpts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [rowErrors, setRowErrors] = useState({});
  const [expanded, setExpanded] = useState({}); // UI-only: which rows show advanced options

  // Provider dropdown = static registry (AI_PROVIDERS) + dynamic compatible nodes
  // (/api/provider-nodes) so user-created providers like anthropic-compatible-<uuid> appear.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    Promise.all([
      fetch("/api/settings", { cache: "no-store" }).then(r => r.ok ? r.json() : {}),
      fetch("/api/provider-nodes", { cache: "no-store" }).then(r => r.ok ? r.json() : { nodes: [] }).catch(() => ({ nodes: [] })),
    ]).then(([settings, nodesData]) => {
      const rules = Array.isArray(settings.providerSkipRules) ? settings.providerSkipRules : [];
      setRows(rules.map(ruleToRow));
      setProviderOpts(mergeProviderOptions(AI_PROVIDERS, nodesData.nodes));
    }).finally(() => setLoading(false));
  }, [open]);

  const updateRow = (i, patch) => {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setRowErrors(prev => { const next = { ...prev }; delete next[i]; return next; });
  };
  const addRow = () => setRows([...rows, emptyRule()]);
  const removeRow = (i) => setRows(rows.filter((_, idx) => idx !== i));
  const toggleExpanded = (i) => setExpanded(prev => ({ ...prev, [i]: !prev[i] }));

  const save = async () => {
    setError("");
    // Validate every row up front. Flag the exact rows that fail instead of
    // silently dropping incomplete/invalid ones on save.
    const providerSkipRules = [];
    const errs = {};
    rows.forEach((row, i) => {
      const { rule, error: rowErr } = rowToRule(row);
      if (rowErr) errs[i] = rowErr;
      else providerSkipRules.push(rule);
    });
    if (Object.keys(errs).length > 0) {
      setRowErrors(errs);
      setError(`Có ${Object.keys(errs).length} dòng chưa hợp lệ — sửa các dòng được đánh dấu.`);
      return;
    }
    setRowErrors({});
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerSkipRules }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to save");
        return;
      }
      onSaved?.(providerSkipRules);
      onClose?.();
    } catch (e) {
      setError(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // Compact footer: the Modal footer bar is a separate flow row below the
  // scrollable body (single scroll region, never overlaps a rule). -my-2.5
  // trims the bar's hardcoded p-6 to ~14px vertical without touching Modal.
  const footer = (
    <div className="flex items-center gap-3 w-full -my-2.5">
      {error && <div className="mr-auto text-xs text-red-500">{error}</div>}
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onClose} disabled={saving}>Hủy</Button>
        <Button size="sm" variant="primary" onClick={save} loading={saving}>Lưu</Button>
      </div>
    </div>
  );

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Skip-error rules"
      size="lg"
      className="!max-w-[800px] w-full"
      footer={footer}
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-text-muted leading-relaxed">
          Khi provider trả lỗi khớp rule: <b>Skip</b> = bỏ account, nhảy backup ngay (không cooldown) ·
          <b> Retry</b> = gọi lại account. Điền status và/hoặc text (có cả hai thì phải khớp cả hai).
        </p>

        {loading ? (
          <div className="text-sm text-text-muted">Loading…</div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Shared suggestions for every HTTP-status input (list="skip-rule-status-suggestions"). */}
            <datalist id="skip-rule-status-suggestions">
              {SUGGESTED_STATUSES.map(s => (
                <option key={s} value={s} />
              ))}
            </datalist>
            {rows.length === 0 && (
              <div className="text-sm text-text-muted italic py-2">Chưa có quy tắc nào. Bấm &quot;Thêm quy tắc&quot; để bắt đầu.</div>
            )}
            {rows.map((row, i) => {
              const showAdvanced = row.action === "skip" || (row.matchMode === "kind" && row.kind === "connect_timeout");
              return (
              <div key={i} className={cn("px-3 py-2.5 border rounded-lg bg-surface-2", rowErrors[i] ? "border-red-500" : "border-border")}>
                {/* Responsive main row:
                    mobile  → 1 col, everything stacked
                    md      → 2 cols × 2 rows  (Provider | Điều kiện  /  Action | Xóa)
                    lg      → 1 row: Provider | Điều kiện | Action | Xóa */}
                <div className="grid gap-2 items-end grid-cols-1 md:grid-cols-[140px_minmax(0,1fr)] lg:grid-cols-[minmax(120px,150px)_minmax(280px,1fr)_auto_auto]">
                  {/* 1 · Provider */}
                  <Field label="Provider">
                    <Select
                      options={providerOpts}
                      value={row.provider}
                      onChange={(e) => updateRow(i, { provider: e.target.value })}
                      placeholder="Chọn provider"
                      selectClassName={FIELD_CLS}
                      aria-label="Provider"
                    />
                  </Field>

                  {/* 2 · Điều kiện: Kiểu lỗi + (Status + Text) | (Loại transport) */}
                  <div className="flex flex-wrap gap-2 items-end min-w-0">
                    <Field label="Kiểu lỗi" className="w-[104px] shrink-0">
                      <Select
                        options={MATCH_MODES}
                        value={row.matchMode}
                        onChange={(e) => updateRow(i, { matchMode: e.target.value })}
                        selectClassName={FIELD_CLS}
                        aria-label="Kiểu lỗi"
                      />
                    </Field>
                    {row.matchMode === "http" ? (
                      <>
                        <Field label="HTTP status" className="w-[92px] shrink-0">
                          <Input
                            type="number"
                            list="skip-rule-status-suggestions"
                            value={row.status}
                            onChange={(e) => updateRow(i, { status: e.target.value })}
                            placeholder="mọi mã"
                            inputClassName={FIELD_CLS}
                            title="HTTP status — để trống = mọi mã lỗi"
                            aria-label="HTTP status"
                          />
                        </Field>
                        <Field label="Text chứa" className="flex-1 min-w-[120px]">
                          <Input
                            value={row.contains}
                            onChange={(e) => updateRow(i, { contains: e.target.value })}
                            placeholder="tùy chọn — vd: overloaded"
                            inputClassName={FIELD_CLS}
                            title="Text trong body lỗi — điền để lọc chắc hơn (khớp cả mã + text)"
                            aria-label="Text chứa"
                          />
                        </Field>
                      </>
                    ) : (
                      <Field label="Loại transport" className="flex-1 min-w-[140px]">
                        <Select
                          options={KIND_OPTIONS}
                          value={row.kind}
                          onChange={(e) => updateRow(i, { kind: e.target.value })}
                          selectClassName={FIELD_CLS}
                          aria-label="Loại lỗi transport"
                        />
                      </Field>
                    )}
                  </div>

                  {/* 3 · Action — one segmented control; contrast root vs card via !bg-bg + border */}
                  <SegmentedControl
                    size="md"
                    options={ACTION_OPTIONS}
                    value={row.action}
                    onChange={(v) => updateRow(i, v === "retry" ? { action: v, sweep: false } : { action: v })}
                    className="!bg-bg border border-border"
                  />

                  {/* 4 · Xóa */}
                  <div className="flex justify-start md:justify-end lg:justify-start">
                    <Button size="sm" variant="ghost" icon="delete" onClick={() => removeRow(i)} title="Xóa quy tắc" aria-label="Xóa quy tắc" />
                  </div>
                </div>

                {rowErrors[i] && (
                  <div className="mt-1.5 text-xs text-red-500">{rowErrors[i]}</div>
                )}

                {/* Advanced options — collapsed by default; only when relevant */}
                {showAdvanced && (
                  <div className="mt-1.5">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(i)}
                      className="flex items-center gap-1 text-xs text-text-muted hover:text-text-main transition-colors"
                    >
                      <span className={cn("material-symbols-outlined text-[16px] transition-transform", expanded[i] && "rotate-180")}>expand_more</span>
                      Tùy chọn nâng cao
                    </button>
                    {expanded[i] && (
                      <div className="mt-2 flex flex-col gap-2.5 pl-1">
                        {row.action === "skip" && (
                          <Toggle
                            checked={!!row.sweep}
                            onChange={(v) => updateRow(i, { sweep: v })}
                            label="Quét lại toàn pool khi hết account"
                            description="Cho lỗi capacity thoáng qua — thử lại tất cả account thêm vài vòng."
                          />
                        )}
                        {row.matchMode === "kind" && row.kind === "connect_timeout" && (
                          <div className="w-[200px]">
                            <Field label="Header timeout (ms)">
                              <Input
                                type="number"
                                value={row.headerTimeoutMs}
                                onChange={(e) => updateRow(i, { headerTimeoutMs: e.target.value })}
                                placeholder="25000"
                                inputClassName={FIELD_CLS}
                                title="Mặc định 60000"
                                aria-label="Header timeout (ms)"
                              />
                            </Field>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              );
            })}

            <div className="mt-0.5">
              <Button size="sm" variant="ghost" icon="add" onClick={addRow}>Thêm quy tắc</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
