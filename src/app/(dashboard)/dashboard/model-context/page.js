"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, Button, Input, MultiSelect, SegmentedControl } from "@/shared/components";
import { invalidateModelCaps } from "@/shared/hooks/useModelCaps.js";

// Context-window management table. One row = one registered model's effective
// contextWindow. The default view is the in-use world (providers with an active
// connection first); the rest is reachable via filters (status / coverage /
// connection / window range). Overrides are the exceptional state and are
// rendered inline on their rows instead of a separate list.
//
// Override resolution mirrors applyContextOverrides() in
// open-sse/providers/capabilities.js exactly:
//   scoped "provider/model" > bare model id > exact model-with-slash > glob
//   (glob: first matching key in insertion order; case-insensitive per
//   matchPattern() in open-sse/providers/pricing.js)

const HIDDEN_KEY = "mcHiddenModels"; // localStorage: ["provider/model", …]
const ROW_CAP = 250; // initial render cap; "show all N" below the table

function globToRegex(pattern) {
  return new RegExp(
    "^" +
      pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") +
      "$",
    "i" // matchPattern() is case-insensitive
  );
}

// Accepts 200k / 1m / 1.5m / 128000 → positive int | null.
function parseWindow(str) {
  const m = /^([\d,.]+)\s*([km])?$/i.exec((str || "").trim());
  if (!m || !m[1]) return null;
  const num = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(num) || num <= 0) return null;
  const mult = m[2] ? { k: 1000, m: 1000000 }[m[2].toLowerCase()] : 1;
  const v = Math.round(num * mult);
  return v > 0 ? v : null;
}

function fmtInt(n) {
  return n == null ? "-" : Number(n).toLocaleString();
}

function baseModelOf(model) {
  return model.includes("/") ? model.split("/").pop() : model;
}

// Which override (if any) controls this model — same precedence as the engine.
function resolveSource(overrides, provider, model) {
  const baseModel = baseModelOf(model);
  const fullKey = `${provider}/${baseModel}`;
  if (overrides[fullKey] != null) return { type: "scoped", key: fullKey, value: overrides[fullKey] };
  if (overrides[baseModel] != null) return { type: "bare", key: baseModel, value: overrides[baseModel] };
  if (overrides[model] != null) return { type: "scoped", key: model, value: overrides[model] };
  for (const [k, v] of Object.entries(overrides)) {
    if (!k.includes("*")) continue;
    try {
      const re = globToRegex(k);
      if (re.test(fullKey) || re.test(baseModel)) return { type: "glob", key: k, value: v };
    } catch {
      /* invalid glob — the engine ignores it too */
    }
  }
  return null;
}

function ModelContextPage() {
  // Data
  const [overrides, setOverrides] = useState({});
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Filters
  const [q, setQ] = useState("");
  const [providersSel, setProvidersSel] = useState([]);
  // Default to the in-use world (models actually exposed in /v1/models);
  // click 状态 again (or 未启用) to see the dormant catalog.
  const [statusF, setStatusF] = useState("active"); // all | active | inactive
  const [covF, setCovF] = useState("all"); // all | covered | uncovered
  const [connF, setConnF] = useState("all"); // all | yes | no
  const [minW, setMinW] = useState("");
  const [maxW, setMaxW] = useState("");

  // Table interactions
  const [sort, setSort] = useState({ key: null, dir: 1 }); // key: eff | model | provider
  const [selected, setSelected] = useState(() => new Set()); // row fullKeys
  const [editing, setEditing] = useState(null); // { rowKey, value }
  const [notice, setNotice] = useState("");

  // Hidden models (view-layer noise reduction)
  const [hidden, setHidden] = useState(() => new Set());
  const [hiddenView, setHiddenView] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Panels & form
  const [keysOpen, setKeysOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [batchVal, setBatchVal] = useState("");
  const [formKey, setFormKey] = useState("");
  const [formWindow, setFormWindow] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/model-context", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load");
        if (cancelled) return;
        setOverrides(data.overrides || {});
        setModels(data.models || []);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Deferred hydrate of hidden models (avoids SSR/CSR mismatch).
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem(HIDDEN_KEY);
        if (raw) setHidden(new Set(JSON.parse(raw)));
      } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const persistHidden = (next) => {
    setHidden(next);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
    } catch {}
    // Restoring the last hidden row shouldn't strand the user in an empty
    // reverse view — drop back to the normal list.
    if (next.size === 0) setHiddenView(false);
  };

  const providerOptions = useMemo(() => {
    const seen = new Map();
    for (const m of models) {
      if (!seen.has(m.provider)) seen.set(m.provider, m.providerName || m.provider);
    }
    return [...seen.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
  }, [models]);

  // Effective rows + per-key hit counts (orphan detection for the keys panel).
  const rowsData = useMemo(() => {
    const list = [];
    const hits = {};
    for (const m of models) {
      const src = resolveSource(overrides, m.provider, m.model);
      const base = m.staticContextWindow ?? m.contextWindow;
      const eff = src ? src.value : base;
      if (src) hits[src.key] = (hits[src.key] || 0) + 1;
      list.push({
        fullKey: `${m.provider}/${baseModelOf(m.model)}`,
        provider: m.provider,
        providerName: m.providerName,
        providerActive: m.providerActive,
        // Model-level enablement (in /v1/models), not just "provider has an
        // enabled connection" — a connected provider may only expose a few.
        enabledModel: m.defaultVisible ?? false,
        providerConnections: m.providerConnections ?? 0,
        model: m.model,
        name: m.name,
        base,
        eff,
        src,
      });
    }
    return { list, hits };
  }, [models, overrides]);




  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const lo = parseWindow(minW);
    const hi = parseWindow(maxW);
    let list = rowsData.list;

    // Hidden gating first: default mode drops hidden rows entirely; the
    // reverse view shows ONLY hidden rows (restore is one click away).
    if (hiddenView) list = list.filter((r) => hidden.has(r.fullKey));
    else list = list.filter((r) => !hidden.has(r.fullKey));

    if (needle) {
      list = list.filter(
        (r) =>
          r.model.toLowerCase().includes(needle) ||
          (r.name || "").toLowerCase().includes(needle) ||
          r.provider.toLowerCase().includes(needle) ||
          (r.providerName || "").toLowerCase().includes(needle)
      );
    }
    if (providersSel.length) list = list.filter((r) => providersSel.includes(r.provider));
    if (statusF === "active") list = list.filter((r) => r.enabledModel);
    if (statusF === "inactive") list = list.filter((r) => !r.enabledModel);
    if (covF === "covered") list = list.filter((r) => r.src);
    if (covF === "uncovered") list = list.filter((r) => !r.src);
    if (connF === "yes") list = list.filter((r) => r.providerConnections > 0);
    if (connF === "no") list = list.filter((r) => r.providerConnections === 0);
    if (lo != null) list = list.filter((r) => r.eff != null && r.eff >= lo);
    if (hi != null) list = list.filter((r) => r.eff != null && r.eff <= hi);

    // Default order: active-first (the in-use world), then provider, then model.
    const dir = sort.dir;
    if (sort.key === "eff") {
      list.sort((a, b) => ((a.eff ?? -1) - (b.eff ?? -1)) * dir || a.model.localeCompare(b.model));
    } else if (sort.key === "model") {
      list.sort((a, b) => a.model.localeCompare(b.model) * dir);
    } else if (sort.key === "provider") {
      list.sort((a, b) => a.provider.localeCompare(b.provider) * dir || a.model.localeCompare(b.model));
    } else {
      list.sort(
        (a, b) =>
          (b.enabledModel ? 1 : 0) - (a.enabledModel ? 1 : 0) ||
          a.provider.localeCompare(b.provider) ||
          a.model.localeCompare(b.model)
      );
    }
    return list;
  }, [rowsData, hidden, hiddenView, q, providersSel, statusF, covF, connF, minW, maxW, sort]);

  const visible = hiddenView ? filtered : filtered.slice(0, showAll ? filtered.length : ROW_CAP);
  const orphans = useMemo(
    () => Object.keys(overrides).filter((k) => !(rowsData.hits[k] > 0)),
    [overrides, rowsData]
  );
  const coveredCount = Object.keys(overrides).length;

  // ---- actions -----------------------------------------------------------

  const flashNotice = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 4000);
  };

  const saveOverride = async (key, contextWindow) => {
    setSaving(true);
    try {
      const res = await fetch("/api/model-context", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, contextWindow }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setOverrides(data.overrides || {});
      invalidateModelCaps();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Multi-key delete via the bulk endpoint (one write + one engine reload).
  const deleteKeysBulk = async (keys) => {
    if (!keys.length) return;
    setSaving(true);
    try {
      const res = await fetch("/api/model-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteKeys: keys }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      setOverrides(data.overrides || {});
      invalidateModelCaps();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (r) => {
    setEditing({ rowKey: r.fullKey, value: r.eff == null ? "" : String(r.eff) });
  };

  // Any row's ✏️ writes a precise scoped override — after saving, scoped has
  // the highest precedence, so the row's effective value becomes this number.
  const commitEdit = async () => {
    if (!editing) return;
    const row = rowsData.list.find((r) => r.fullKey === editing.rowKey);
    if (!row) { setEditing(null); return; }
    const window = parseWindow(editing.value);
    if (window === null) {
      setError("窗口需为正整数,支持 200k / 1m 缩写");
      return;
    }
    if (await saveOverride(row.fullKey, window)) {
      flashNotice(`${row.model} → ${window.toLocaleString()}`);
      setEditing(null);
    }
  };

  // Revert only removes a scoped override. Rows controlled by bare/glob keys
  // can't revert individually (no null override exists) — the controlling key
  // must be removed in the overrides panel.
  const revertRow = async (row) => {
    await deleteKeysBulk([row.src.key]);
    flashNotice(`${row.model} 已恢复默认值`);
  };

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const allOn = visible.length > 0 && visible.every((r) => prev.has(r.fullKey));
      return allOn ? new Set() : new Set(visible.map((r) => r.fullKey));
    });
  };

  const toggleRow = (rowKey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  // Batch: set every selected row to one value (scoped overrides per row).
  const handleBatchSet = async () => {
    const window = parseWindow(batchVal);
    if (window === null) {
      setError("窗口需为正整数,支持 200k / 1m 缩写");
      return;
    }
    const set = [...selected].map((k) => ({ key: k, contextWindow: window }));
    setSaving(true);
    try {
      const res = await fetch("/api/model-context", {
        method: "POST",
        body: JSON.stringify({ set }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setOverrides(data.overrides || {});
      invalidateModelCaps();
      flashNotice(`已批量设置 ${set.length} 项 → ${window.toLocaleString()}`);
      setSelected(new Set());
      setBatchVal("");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Batch clear: only removes keys the selected rows own outright; rows
  // controlled by bare/glob keys are skipped (deleting those would affect
  // unselected models too).
  const handleBatchClear = async () => {
    const ownKeys = [...selected].map((k) =>
      rowsData.list.find((r) => r.fullKey === k)
    ).filter((r) => r && r.src && r.src.type === "scoped").map((r) => r.src.key);
    const skipped = selected.size - new Set(ownKeys).size;
    await deleteKeysBulk([...new Set(ownKeys)]);
    if (skipped > 0) {
      flashNotice(`已清除 ${ownKeys.length} 项覆盖;${skipped} 项受全局/glob 覆盖控制,未改动`);
    } else {
      flashNotice(`已清除 ${ownKeys.length} 项覆盖`);
    }
    setSelected(new Set());
  };

  const handleBatchHide = () => {
    const next = new Set(hidden);
    for (const k of selected) next.add(k);
    persistHidden(next);
    setSelected(new Set());
    setHiddenView(false);
  };

  // Hide/restore a single row (persists to localStorage via persistHidden).
  const toggleHideRow = (row) => {
    const next = new Set(hidden);
    if (hidden.has(row.fullKey)) next.delete(row.fullKey);
    else next.add(row.fullKey);
    persistHidden(next);
  };

  // Manual add: a bare id, provider-scoped key, or glob — as typed.
  const submitAddForm = async () => {
    const key = formKey.trim();
    const window = parseWindow(formWindow);
    if (!key) { setFormError("Key required"); return; }
    if (window === null) {
      setFormError("窗口需为正整数,支持 200k / 1m 缩写");
      return;
    }
    if (await saveOverride(key, window)) {
      setFormKey("");
      setFormWindow("");
      setFormError("");
      flashNotice(`已添加覆盖 ${key} → ${window.toLocaleString()}`);
    }
  };

  // Live preview of what a manually entered key would hit (0 = typo warning).
  const formPreview = useMemo(() => {
    const k = formKey.trim();
    if (!k) return null;
    const matches = models.filter((m) => {
      const baseModel = baseModelOf(m.model);
      const full = `${m.provider}/${baseModel}`;
      if (k.includes("*")) {
        try { return globToRegex(k).test(full) || globToRegex(k).test(baseModel); }
        catch { return false; }
      }
      return k === full || k === baseModel || k === m.model;
    });
    return { count: matches.length };
  }, [formKey, models]);

  // Datalist for the manual-add key input: exact scoped keys plus the distinct
  // bare model ids, so "glm-5.3" autocompletes to whatever models exist.
  const keyOptions = useMemo(() => {
    const scoped = Object.keys(overrides).filter((k) => k.includes("/"));
    const bare = new Set(scoped.map((k) => k.slice(k.indexOf("/") + 1)));
    for (const m of models) bare.add(baseModelOf(m.model));
    return [...new Set([...scoped, ...bare])].sort();
  }, [overrides, models]);

  // ---- render ------------------------------------------------------------

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.fullKey));

  const sortIcon = (key) =>
    sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : "";

  const toggleSort = (key) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: -prev.dir } : { key, dir: 1 }
    );
  };

  // Segmented filters act as toggles: click a condition to apply it, click it
  // again to drop back to "all".
  const segToggle = (setter) => (v) =>
    setter((prev) => (prev === v ? "all" : v));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Model Context</h1>
        <p className="text-sm text-text-muted mt-1">
          核对每个模型的上下文窗口，不对就直接改。「启用中」的供应商模型排在最前，即 <code>/v1/models</code> 当前对外可见的集合；改动立即生效于路由与 <code>/v1/models</code>。
        </p>
      </div>

      {error && (
        <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} title="关闭">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}
      {notice && (
        <div className="text-xs text-green-600 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">
          {notice}
        </div>
      )}

      <Card padding="none" className="min-w-0">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <Input
            placeholder="搜索模型 / 供应商…"
            icon="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-48"
          />
          <MultiSelect
            options={providerOptions}
            value={providersSel}
            onChange={(v) => setProvidersSel(v)}
            allLabel="All providers"
            className="w-44"
          />
          <SegmentedControl
            size="sm"
            options={[{ value: "all", label: "状态" }, { value: "active", label: "启用" }, { value: "inactive", label: "未启用" }]}
            value={statusF}
            onChange={segToggle(setStatusF)}
          />
          <SegmentedControl
            size="sm"
            options={[{ value: "all", label: "覆盖" }, { value: "covered", label: "已覆盖" }, { value: "uncovered", label: "未覆盖" }]}
            value={covF}
            onChange={segToggle(setCovF)}
          />
          {/* connF = the provider has been configured with at least one connection record,
              enabled or not — orthogonal to model enablement. */}
          <span title="连接 = 该供应商配置过连接(含已停用)。有连接但模型仍未启用 → 去供应商页勾选该模型">
            <SegmentedControl
              size="sm"
              options={[{ value: "all", label: "连接" }, { value: "yes", label: "有" }, { value: "no", label: "无" }]
              }
              value={connF}
              onChange={segToggle(setConnF)}
            />
          </span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              placeholder="窗口 ≥"
              value={minW}
              onChange={(e) => setMinW(e.target.value)}
              className="h-9 w-24 rounded-lg border border-border bg-surface-2 px-2.5 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
            <input
              type="number"
              placeholder="≤"
              value={maxW}
              onChange={(e) => setMaxW(e.target.value)}
              className="h-9 w-16 rounded-lg border border-border bg-surface-2 px-2.5 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" icon={keysOpen ? "expand_less" : "tune"} onClick={() => setKeysOpen(!keysOpen)}>
              覆盖键 ({coveredCount})
            </Button>
            <Button size="sm" variant={hiddenView ? "primary" : "ghost"} icon="visibility_off"
              onClick={() => setHiddenView(!hiddenView)}>
              已隐藏 ({hidden.size})
            </Button>
            <Button size="sm" icon="add" onClick={() => setAddOpen(!addOpen)}>新增</Button>
          </div>
        </div>

        {/* Batch bar */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-brand-500/10 border-b border-border-subtle">
            <span className="text-sm font-medium">已选 {selected.size} 项</span>
            <input
              type="text"
              placeholder="如 200k / 1m"
              value={batchVal}
              onChange={(e) => setBatchVal(e.target.value)}
              className="h-8 w-28 rounded-lg border border-border bg-surface-2 px-2.5 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
            <Button size="sm" onClick={handleBatchSet} disabled={saving}>设为</Button>
            <Button size="sm" variant="ghost" onClick={handleBatchClear} disabled={saving}>
              清除覆盖
            </Button>
          </div>
        )}

        {/* Add override panel */}
        {addOpen && (
          <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-b border-border-subtle bg-sidebar/40">
            <div className="flex-1 min-w-[240px]">
              <label className="block text-xs text-text-muted mb-1">
                Key(裸名全局生效,provider/model 限单供应商,* 通配)
              </label>
              <input
                list="mc-key-options"
                className="w-full h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                placeholder="e.g. zhipu/glm-5.3 或 glm-*"
                value={formKey}
                onChange={(e) => setFormKey(e.target.value)}
              />
              <datalist id="mc-key-options">
                {keyOptions.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
              {formPreview && (
                <p className={`text-[11px] mt-1 ${formPreview.count > 0 ? "text-text-muted" : "text-amber-500"}`}>
                  将命中 {formPreview.count} 个模型{formPreview.count === 0 && " — 检查拼写"}
                </p>
              )}
            </div>
            <div className="w-36">
              <Input label="窗口(tokens)" placeholder="e.g. 200k" value={formWindow}
                onChange={(e) => setFormWindow(e.target.value)} />
            </div>
            <Button onClick={submitAddForm} disabled={saving}>添加覆盖</Button>
          </div>
        )}

        {/* Override keys panel (audit + orphan management) */}
        {keysOpen && (
          <div className="px-4 py-3 border-b border-border-subtle bg-sidebar/40">
            {Object.keys(overrides).length === 0 ? (
              <p className="text-sm text-text-muted">还没有覆盖配置。</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {Object.entries(overrides).map(([k, v]) => {
                  const hitCount = rowsData.hits[k] || 0;
                  return (
                    <div key={k} className="flex items-center justify-between px-3 py-1.5 rounded-lg border border-border-subtle bg-background">
                      <div className="flex items-center gap-2 min-w-0">
                        <code className="text-xs font-mono bg-sidebar px-1.5 py-0.5 rounded">{k}</code>
                        <span className="text-sm font-mono">{fmtInt(v)}</span>
                        {hitCount === 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-500">未命中任何模型</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-text-muted/60">{hitCount} models</span>
                        <button
                          onClick={() => deleteKeysBulk([k])}
                          disabled={saving}
                          className="p-1 hover:bg-red-500/10 rounded text-text-muted hover:text-red-500"
                          title="删除此覆盖"
                        >
                          <span className="material-symbols-outlined text-sm">close</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[880px]">
            <thead>
              <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
                <th className="pl-4 pr-2 py-2 w-8">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} className="h-4 w-4 cursor-pointer" />
                </th>
                <th className="px-2 py-2 font-medium cursor-pointer hover:text-text-main" onClick={() => toggleSort("provider")}>
                  供应商{sortIcon("provider")}
                </th>
                <th className="px-2 py-2 font-medium cursor-pointer hover:text-text-main" onClick={() => toggleSort("model")}>
                  模型{sortIcon("model")}
                </th>
                <th className="px-2 py-2 font-medium cursor-pointer hover:text-text-main" onClick={() => toggleSort("eff")}>
                  生效窗口{sortIcon("eff")}
                </th>
                <th className="px-2 py-2 font-medium">来源</th>
                <th className="pl-2 pr-4 py-2 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-text-muted">Loading…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                  {hiddenView ? "没有已隐藏的模型。" : "没有匹配的模型。"}
                </td></tr>
              ) : (
                visible.map((r) => (
                  <tr key={r.fullKey} className="border-b border-border-subtle last:border-b-0 hover:bg-sidebar/50">
                    <td className="pl-4 pr-2 py-2">
                      <input type="checkbox" checked={selected.has(r.fullKey)} onChange={() => toggleRow(r.fullKey)} className="h-4 w-4 cursor-pointer" />
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <span>{r.providerName}</span>
                      {!r.enabledModel && (
                        <span
                          title={r.providerActive ? "供应商已有启用的连接，但该模型不在 /v1/models 中（未勾选）" : "该供应商没有启用的连接"}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted/60 ml-1"
                        >
                          未启用
                        </span>
                      )}
                      <code className="text-[10px] font-mono bg-sidebar px-1 py-0.5 rounded text-text-muted/60 ml-1">{r.provider}</code>
                    </td>
                    <td className="px-2 py-2 max-w-[260px]">
                      <code className="text-xs font-mono bg-sidebar px-1.5 py-0.5 rounded truncate block">{r.model}</code>
                      {r.name && r.name !== r.model ? <span className="text-[10px] text-text-muted/70 truncate block">{r.name}</span> : null}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap tabular-nums">
                      {editing?.rowKey === r.fullKey ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            type="text"
                            value={editing.value}
                            onChange={(e) => setEditing({ rowKey: r.fullKey, value: e.target.value })}
                            onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditing(null); }}
                            className="h-7 w-24 rounded border border-border bg-surface-2 px-2 text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                          />
                          <button
                            onClick={commitEdit}
                            title="确认（Enter）"
                            className="h-7 w-7 flex items-center justify-center rounded bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-40 shrink-0"
                            disabled={saving || editing.value.trim() === ""}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check</span>
                          </button>
                          <button
                            onClick={() => setEditing(null)}
                            title="取消（Esc）"
                            className="h-7 w-7 flex items-center justify-center rounded border border-border text-text-muted hover:bg-surface-2 hover:text-text-main shrink-0"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
                          </button>
                        </div>
                      ) : r.src ? (
                        <div>
                          <span className="text-amber-600 font-medium">{fmtInt(r.eff)}</span>{" "}
                          <s className="text-text-muted/50">{fmtInt(r.base)}</s>
                        </div>
                      ) : (
                        <span>{fmtInt(r.eff)}</span>
                      )}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {r.src ? (
                        <span title={r.src.key} className={r.src.type === "scoped" ? "text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600" : "text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-600"}>
                          {r.src.type === "scoped" ? "手动" : r.src.type === "bare" ? "全局" : "glob"}
                        </span>
                      ) : (
                        <span className="text-text-muted/40">—</span>
                      )}
                    </td>
                    <td className="pl-2 pr-4 py-2 text-right whitespace-nowrap">
                      <button onClick={() => startEdit(r)} title="编辑生效窗口" className="p-1 hover:bg-surface-2 rounded text-text-muted hover:text-primary">
                        <span className="material-symbols-outlined text-sm">edit</span>
                      </button>
                      {r.src?.type === "scoped" ? (
                        <button onClick={() => revertRow(r)} disabled={saving} title="恢复默认（移除此行的覆盖）" className="p-1 hover:bg-red-500/10 rounded text-text-muted hover:text-red-500">
                          <span className="material-symbols-outlined text-sm">restart_alt</span>
                        </button>
                      ) : r.src ? (
                        <span title="由此行的覆盖键控制，可在「覆盖键」面板管理" className="inline-block p-1 text-text-muted/30">
                          <span className="material-symbols-outlined text-sm">restart_alt</span>
                        </span>
                      ) : null}
                      <button onClick={() => toggleHideRow(r)} title={hiddenView ? "取消隐藏" : "隐藏此行"} className="p-1 hover:bg-surface-2 rounded text-text-muted hover:text-primary">
                        <span className="material-symbols-outlined text-sm">{hiddenView ? "visibility" : "visibility_off"}</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border-subtle text-xs text-text-muted">
          <span>
            {hiddenView ? `已隐藏 ${filtered.length} 项` : `显示 ${visible.length} / ${filtered.length} 项`}
            {coveredCount > 0 && hiddenView === false && ` · 已覆盖 ${coveredCount} 项`}
          </span>
          {!hiddenView && !showAll && filtered.length > ROW_CAP && (
            <button onClick={() => setShowAll(true)} className="text-primary hover:underline cursor-pointer">
              显示全部 {filtered.length} 行
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}

export default ModelContextPage;
