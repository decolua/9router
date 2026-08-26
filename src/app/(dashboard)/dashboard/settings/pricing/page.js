"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, ConfirmModal, DropdownSelect, Input, Modal, PopupMenu, PopupMenuItem, Toggle } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

const FIELDS = [
  ["input", "输入 Token"],
  ["output", "输出 Token"],
  ["cached", "缓存读取"],
  ["cache_creation", "缓存写入"],
  ["reasoning", "推理 Token"],
];
const EMPTY_RATES = Object.fromEntries(FIELDS.map(([field]) => [field, ""]));
const EMPTY_VALUES = {
  ...EMPTY_RATES,
  peakEnabled: false,
  peakWindows: "",
  peakPricing: { ...EMPTY_RATES },
  offPeakPricing: { ...EMPTY_RATES },
};
const PAGE_SIZE = 50;
const providerModelKey = (item) => `${item.provider}\u0000${item.model}`;

function formatRate(value) {
  return Number(value || 0).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function RateFields({ values, onChange }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {FIELDS.map(([field, label]) => <Input
      key={field}
      label={`${label}（美元/百万 Token）`}
      type="number"
      min="0"
      step="0.000001"
      value={values[field] ?? ""}
      placeholder="0"
      onChange={(event) => onChange(field, event.target.value)}
    />)}
  </div>;
}

function PricingForm({ model, values, editing, onModelChange, onChange }) {
  return <div className="flex flex-col gap-5">
    <Input label="定价模型 ID" value={model} disabled={editing} placeholder="例如 glm-5.3" onChange={(event) => onModelChange(event.target.value)} />
    <div>
      <p className="mb-3 text-sm font-semibold">基础定价</p>
      <RateFields values={values} onChange={onChange} />
    </div>
    <div className="border-t border-border pt-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">峰谷定价</p>
          <p className="text-xs text-text-muted">按中国时间判断，支持多个时段。</p>
        </div>
        <Toggle checked={values.peakEnabled === true} onChange={(checked) => onChange("peakEnabled", checked)} />
      </div>
      {values.peakEnabled && <div className="mt-4 flex flex-col gap-4">
        <Input label="峰时时段（中国时间）" value={values.peakWindows || ""} placeholder="例如：09:00-12:00,14:00-18:00" onChange={(event) => onChange("peakWindows", event.target.value)} />
        <div>
          <p className="mb-3 text-sm font-semibold text-red-500">峰时定价</p>
          <RateFields values={values.peakPricing || EMPTY_RATES} onChange={(field, value) => onChange("peakPricing", { ...(values.peakPricing || {}), [field]: value })} />
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold text-emerald-600">谷时定价</p>
          <RateFields values={values.offPeakPricing || EMPTY_RATES} onChange={(field, value) => onChange("offPeakPricing", { ...(values.offPeakPricing || {}), [field]: value })} />
        </div>
      </div>}
    </div>
  </div>;
}

// Compact per-row "选择定价" entry: icon button + portal menu (searchable).
// Replaces the old w-56 DropdownSelect which got clipped by the table scroller.
function MapPricingMenu({ item, options, disabled, onSelect }) {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled || !options.length}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`为 ${item.provider}/${item.model} 选择定价`}
        title={!options.length ? "暂无可选定价模型" : "选择定价"}
        onClick={() => setOpen((v) => !v)}
        className="flex size-9 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-[18px]">sell</span>
      </button>
      <PopupMenu open={open} onClose={() => setOpen(false)} triggerRef={btnRef} searchable searchPlaceholder="搜索定价模型" minWidth={220}>
        {(query) => {
          const matched = query ? options.filter((o) => o.label.toLowerCase().includes(query)) : options;
          return (
            <div role="listbox" className="max-h-64 overflow-y-auto p-1 custom-scrollbar">
              {matched.length ? matched.map((option) => (
                <PopupMenuItem
                  key={option.value}
                  active={false}
                  onClick={() => { setOpen(false); onSelect(option.value); }}
                >
                  <span className="truncate font-mono text-xs">{option.label}</span>
                </PopupMenuItem>
              )) : <p className="px-3 py-5 text-center text-xs text-text-muted">没有匹配项</p>}
            </div>
          );
        }}
      </PopupMenu>
    </>
  );
}

function toPricing(values) {
  const rates = Object.fromEntries(FIELDS.map(([field]) => [field, Number(values[field] || 0)]));
  return {
    ...rates,
    peakEnabled: values.peakEnabled === true,
    peakWindows: String(values.peakWindows || "").trim(),
    peakPricing: Object.fromEntries(FIELDS.map(([field]) => [field, Number(values.peakPricing?.[field] ?? rates[field])])),
    offPeakPricing: Object.fromEntries(FIELDS.map(([field]) => [field, Number(values.offPeakPricing?.[field] ?? rates[field])])),
  };
}

function fromPricing(pricing = {}) {
  return {
    ...Object.fromEntries(FIELDS.map(([field]) => [field, String(pricing[field] ?? 0)])),
    peakEnabled: pricing.peakEnabled === true,
    peakWindows: pricing.peakWindows || "",
    peakPricing: Object.fromEntries(FIELDS.map(([field]) => [field, String(pricing.peakPricing?.[field] ?? pricing[field] ?? 0)])),
    offPeakPricing: Object.fromEntries(FIELDS.map(([field]) => [field, String(pricing.offPeakPricing?.[field] ?? pricing[field] ?? 0)])),
  };
}

export default function PricingSettingsPage() {
  const notifySuccess = useNotificationStore((state) => state.success);
  const notifyError = useNotificationStore((state) => state.error);
  const notifyWarning = useNotificationStore((state) => state.warning);
  const [data, setData] = useState({ priced: [], providerModels: [], unpriced: [], defaultPricingModel: "" });
  const [activeTab, setActiveTab] = useState("priced");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState(null);
  const [editorModel, setEditorModel] = useState("");
  const [editorValues, setEditorValues] = useState(EMPTY_VALUES);
  const [mappingTarget, setMappingTarget] = useState(null);
  const [mappingSearch, setMappingSearch] = useState("");
  const [mappingSelection, setMappingSelection] = useState(new Set());
  const [selectedUnpriced, setSelectedUnpriced] = useState(new Set());
  const [batchTarget, setBatchTarget] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [disableConfirm, setDisableConfirm] = useState(null);

  const loadPricing = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/pricing", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "加载模型定价失败");
      setData(payload);
    } catch (error) {
      notifyError(error.message || "加载模型定价失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    fetch("/api/pricing", { cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.error || "加载模型定价失败");
        if (active) setData(payload);
      })
      .catch((error) => { if (active) notifyError(error.message || "加载模型定价失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [notifyError]);

  const mutate = async (body) => {
    setSaving(true);
    try {
      const response = await fetch("/api/pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "保存模型定价失败");
      setData(payload);
      return payload;
    } catch (error) {
      notifyError(error.message || "保存模型定价失败");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const source = activeTab === "priced" ? data.priced : data.unpriced;
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return source;
    return source.filter((item) => {
      const text = activeTab === "priced" ? item.model : `${item.providerName} ${item.provider} ${item.model}`;
      return terms.every((term) => text.toLowerCase().includes(term));
    });
  }, [activeTab, data.priced, data.unpriced, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const pricingOptions = useMemo(() => data.priced.map((item) => ({ value: item.model, label: item.model })), [data.priced]);

  const openCreate = () => {
    setEditor({ mode: "create" });
    setEditorModel("");
    setEditorValues({ ...EMPTY_VALUES, peakPricing: { ...EMPTY_RATES }, offPeakPricing: { ...EMPTY_RATES } });
  };

  const openEdit = (item) => {
    setEditor({ mode: "edit", item });
    setEditorModel(item.model);
    setEditorValues(fromPricing(item.pricing));
  };

  const saveEditor = async () => {
    if (!editorModel.trim()) return notifyWarning("请填写定价模型 ID");
    const result = await mutate({ action: "upsertPricing", model: editorModel.trim(), pricing: toPricing(editorValues) });
    if (result) {
      setEditor(null);
      notifySuccess(editor?.mode === "create" ? "定价模型已新增" : "模型定价已保存");
    }
  };

  const openMappings = (item) => {
    setMappingTarget(item);
    setMappingSearch("");
    setMappingSelection(new Set(data.providerModels.filter((model) => model.mappedPricingModel === item.model).map(providerModelKey)));
  };

  const visibleMappingModels = useMemo(() => {
    if (!mappingTarget) return [];
    const terms = mappingSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return data.providerModels.filter((item) => {
      const text = `${item.providerName} ${item.provider} ${item.model}`.toLowerCase();
      return !terms.length || terms.every((term) => text.includes(term));
    });
  }, [data.providerModels, mappingSearch, mappingTarget]);

  const saveMappings = async () => {
    const models = data.providerModels
      .filter((item) => mappingSelection.has(providerModelKey(item)))
      .map(({ provider, model }) => ({ provider, model }));
    const result = await mutate({ action: "setMappings", pricingModel: mappingTarget.model, models });
    if (result) {
      setMappingTarget(null);
      notifySuccess(`已保存 ${models.length} 个模型映射`);
    }
  };

  const syncPricing = async () => {
    setSyncing(true);
    try {
      const response = await fetch("/api/pricing/sync", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "从 OpenCode 更新定价失败");
      await loadPricing();
      notifySuccess(`已同步 ${payload.syncedCount || 0} 个全局定价模型，更新 ${payload.updatedCount || 0} 个`);
    } catch (error) {
      notifyError(error.message || "从 OpenCode 更新定价失败");
    } finally {
      setSyncing(false);
    }
  };

  const mapSelected = async () => {
    if (!batchTarget) return notifyWarning("请选择目标定价模型");
    const models = data.unpriced.filter((item) => selectedUnpriced.has(providerModelKey(item))).map(({ provider, model }) => ({ provider, model }));
    const result = await mutate({ action: "mapModels", pricingModel: batchTarget, models });
    if (result) {
      setSelectedUnpriced(new Set());
      notifySuccess(`已映射 ${models.length} 个模型`);
    }
  };

  const mapSingle = async (item, pricingModel) => {
    const result = await mutate({ action: "mapModels", pricingModel, models: [{ provider: item.provider, model: item.model }] });
    if (result) notifySuccess(`${item.provider}/${item.model} 已映射到 ${pricingModel}`);
  };

  const runBulkMapping = async () => {
    const result = await mutate({ action: "bulkMapSameName" });
    if (result) {
      setBulkConfirm(false);
      notifySuccess(`已新增 ${result.result?.mappedCount || 0} 个同名映射`);
    }
  };

  const confirmDisableModels = async () => {
    const items = disableConfirm?.items || [];
    const result = await mutate({
      action: "disableProviderModels",
      models: items.map(({ provider, disableProviderAlias, model }) => ({ provider: disableProviderAlias || provider, model })),
    });
    if (result) {
      setDisableConfirm(null);
      setSelectedUnpriced(new Set());
      notifySuccess(`已禁用 ${items.length} 个模型`);
    }
  };

  const confirmDelete = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/pricing?model=${encodeURIComponent(deleteTarget.model)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "删除模型定价失败");
      setData(payload);
      setDeleteTarget(null);
      notifySuccess("定价模型已删除");
    } catch (error) {
      notifyError(error.message || "删除模型定价失败");
    } finally {
      setSaving(false);
    }
  };

  const visibleUnpricedKeys = activeTab === "unpriced" ? visible.map(providerModelKey) : [];
  const allVisibleSelected = visibleUnpricedKeys.length > 0 && visibleUnpricedKeys.every((key) => selectedUnpriced.has(key));
  const toggleVisibleUnpriced = () => setSelectedUnpriced((current) => {
    const next = new Set(current);
    for (const key of visibleUnpricedKeys) allVisibleSelected ? next.delete(key) : next.add(key);
    return next;
  });

  return <div className="flex min-w-0 flex-col gap-4" data-i18n-skip>
    {!data.defaultPricingModel && !loading && <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
      <span className="material-symbols-outlined text-[20px]">warning</span>
      <p>尚未设置默认定价模型。未显式映射的模型暂时无法计算成本，请在“已定价”中设置一个默认模型。</p>
    </div>}

    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="inline-flex h-10 w-fit items-center rounded-md border border-border bg-surface-2 p-1">
        {[{ id: "priced", label: `已定价 ${data.priced.length}` }, { id: "unpriced", label: `未定价 ${data.unpriced.length}` }].map((tab) => <button
          key={tab.id}
          type="button"
          onClick={() => { setActiveTab(tab.id); setPage(1); }}
          className={`h-8 rounded px-4 text-sm font-medium transition-colors ${activeTab === tab.id ? "bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"}`}
        >{tab.label}</button>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon="link" disabled={!data.priced.length} onClick={() => setBulkConfirm(true)}>批量映射同名模型</Button>
        <Button variant="secondary" icon="sync" loading={syncing} onClick={syncPricing}>从 OpenCode 更新</Button>
        <Button icon="add" onClick={openCreate}>新增定价模型</Button>
      </div>
    </div>

    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <Input icon="search" placeholder={activeTab === "priced" ? "搜索定价模型" : "搜索提供商或模型"} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className="w-full lg:max-w-md" />
      {activeTab === "unpriced" && <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
        <DropdownSelect searchable value={batchTarget} options={pricingOptions} placeholder="选择目标定价模型" onChange={setBatchTarget} className="w-full sm:w-72" />
        <Button icon="link" disabled={!selectedUnpriced.size || !batchTarget} loading={saving} onClick={mapSelected}>映射已选（{selectedUnpriced.size}）</Button>
        <Button variant="danger" icon="block" disabled={!selectedUnpriced.size} loading={saving} onClick={() => setDisableConfirm({ items: data.unpriced.filter((item) => selectedUnpriced.has(providerModelKey(item))) })}>禁用已选（{selectedUnpriced.size}）</Button>
      </div>}
    </div>

    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        {activeTab === "priced" ? <table className="w-full min-w-[1180px] text-sm">
          <thead className="border-b border-border bg-surface-2 text-text-muted"><tr>
            <th className="px-3 py-3 text-left">定价模型</th>
            {FIELDS.map(([, label]) => <th key={label} className="px-3 py-3 text-right">{label}</th>)}
            <th className="px-3 py-3 text-center">映射数量</th>
            <th className="px-3 py-3 text-left">来源</th>
            <th className="px-3 py-3 text-left">更新时间</th>
            <th className="px-3 py-3 text-right">操作</th>
          </tr></thead>
          <tbody className="divide-y divide-border/60">
            {loading ? <tr><td colSpan={11} className="p-10 text-center text-text-muted">正在加载模型定价...</td></tr> : !visible.length ? <tr><td colSpan={11} className="p-10 text-center text-text-muted">没有匹配的定价模型</td></tr> : visible.map((item) => <tr key={item.model} className="hover:bg-surface-2/60">
              <td className="px-3 py-2"><div className="flex items-center gap-2"><span className="font-mono text-xs">{item.model}</span>{item.isDefault && <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">默认</span>}</div></td>
              {FIELDS.map(([field]) => <td key={field} className="px-3 py-2 text-right tabular-nums">{formatRate(item.pricing[field])}</td>)}
              <td className="px-3 py-2 text-center tabular-nums">{item.mappedCount}</td>
              <td className="px-3 py-2 text-xs text-text-muted">{item.pricing.source === "opencode" ? "OpenCode" : item.pricing.source === "migration" ? "历史迁移" : "手工"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs text-text-muted">{item.pricing.lastUpdated ? new Date(item.pricing.lastUpdated).toLocaleString("zh-CN", { hour12: false }) : "-"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                {!item.isDefault && <button className="rounded-md p-2 text-text-muted hover:bg-primary/10 hover:text-primary" title="设为默认定价" onClick={async () => { const result = await mutate({ action: "setDefault", model: item.model }); if (result) notifySuccess(`默认定价已设为 ${item.model}`); }}><span className="material-symbols-outlined text-[18px]">bookmark</span></button>}
                <button className="rounded-md p-2 text-text-muted hover:bg-surface-2 hover:text-primary" title="配置映射" onClick={() => openMappings(item)}><span className="material-symbols-outlined text-[18px]">account_tree</span></button>
                <button className="rounded-md p-2 text-text-muted hover:bg-surface-2 hover:text-primary" title="编辑定价" onClick={() => openEdit(item)}><span className="material-symbols-outlined text-[18px]">edit</span></button>
                <button disabled={item.isDefault} className="rounded-md p-2 text-text-muted hover:bg-red-500/10 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30" title={item.isDefault ? "默认定价不能删除" : "删除定价模型"} onClick={() => setDeleteTarget(item)}><span className="material-symbols-outlined text-[18px]">delete</span></button>
              </td>
            </tr>)}
          </tbody>
        </table> : <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-border bg-surface-2 text-text-muted"><tr>
            <th className="w-12 px-3 py-3"><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisibleUnpriced} aria-label="选择当前页" /></th>
            <th className="px-3 py-3 text-left">提供商</th>
            <th className="px-3 py-3 text-left">模型</th>
            <th className="px-3 py-3 text-left">推荐映射</th>
            <th className="px-3 py-3 text-left">当前有效定价</th>
            <th className="px-3 py-3 text-right">操作</th>
          </tr></thead>
          <tbody className="divide-y divide-border/60">
            {loading ? <tr><td colSpan={6} className="p-10 text-center text-text-muted">正在加载模型目录...</td></tr> : !visible.length ? <tr><td colSpan={6} className="p-10 text-center text-text-muted">没有未定价模型</td></tr> : visible.map((item) => {
              const key = providerModelKey(item);
              return <tr key={key} className="hover:bg-surface-2/60">
                <td className="px-3 py-2 text-center"><input type="checkbox" checked={selectedUnpriced.has(key)} onChange={() => setSelectedUnpriced((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; })} aria-label={`选择 ${item.provider}/${item.model}`} /></td>
                <td className="px-3 py-2"><div className="font-medium">{item.providerName}</div><div className="font-mono text-[11px] text-text-muted">{item.provider}</div></td>
                <td className="px-3 py-2 font-mono text-xs">{item.model}</td>
                <td className="px-3 py-2 text-xs">{item.recommendedPricingModel || <span className="text-text-muted">无同名定价</span>}</td>
                <td className="px-3 py-2 text-xs">{item.usesDefault ? <span className="text-text-muted">默认 · {item.effectivePricingModel}</span> : <span className="text-amber-600">未配置</span>}</td>
                <td className="px-3 py-2 text-right"><div className="ml-auto flex w-fit items-center gap-1"><MapPricingMenu item={item} options={pricingOptions} disabled={saving} onSelect={(value) => mapSingle(item, value)} /><button type="button" disabled={saving} onClick={() => setDisableConfirm({ items: [item] })} className="flex size-9 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50" title="禁用模型" aria-label={`禁用 ${item.provider}/${item.model}`}><span className="material-symbols-outlined text-[18px]">block</span></button></div></td>
              </tr>;
            })}
          </tbody>
        </table>}
      </div>
      <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-text-muted">
        <span>共 {filtered.length} 项</span>
        <div className="flex items-center gap-2"><Button size="sm" variant="secondary" icon="chevron_left" disabled={currentPage <= 1} onClick={() => setPage((value) => value - 1)} aria-label="上一页" /><span>{currentPage} / {totalPages}</span><Button size="sm" variant="secondary" icon="chevron_right" disabled={currentPage >= totalPages} onClick={() => setPage((value) => value + 1)} aria-label="下一页" /></div>
      </div>
    </Card>

    <Modal isOpen={!!editor} onClose={() => setEditor(null)} title={editor?.mode === "create" ? "新增定价模型" : `编辑定价 · ${editorModel}`} size="xl" footer={<><Button variant="ghost" onClick={() => setEditor(null)}>取消</Button><Button loading={saving} onClick={saveEditor}>保存</Button></>}>
      <PricingForm model={editorModel} editing={editor?.mode === "edit"} values={editorValues} onModelChange={setEditorModel} onChange={(field, value) => setEditorValues((current) => ({ ...current, [field]: value }))} />
    </Modal>

    <Modal isOpen={!!mappingTarget} onClose={() => setMappingTarget(null)} title={mappingTarget ? `配置映射 · ${mappingTarget.model}` : "配置映射"} size="full" footer={<><Button variant="ghost" onClick={() => setMappingTarget(null)}>取消</Button><Button loading={saving} onClick={saveMappings}>保存映射（{mappingSelection.size}）</Button></>}>
      <div className="flex flex-col gap-3">
        <Input icon="search" placeholder="搜索提供商或模型" value={mappingSearch} onChange={(event) => setMappingSearch(event.target.value)} />
        <div className="max-h-[55vh] overflow-y-auto rounded-md border border-border custom-scrollbar">
          {visibleMappingModels.map((item) => {
            const key = providerModelKey(item);
            const checked = mappingSelection.has(key);
            const occupied = item.mappedPricingModel && item.mappedPricingModel !== mappingTarget?.model;
            return <label key={key} className="flex cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0 hover:bg-surface-2">
              <input type="checkbox" checked={checked} onChange={() => setMappingSelection((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; })} />
              <span className="w-44 shrink-0 text-sm">{item.providerName}</span>
              <span className="min-w-0 flex-1 font-mono text-xs">{item.provider}/{item.model}</span>
              {occupied && <span className="text-xs text-amber-600">当前映射：{item.mappedPricingModel}</span>}
            </label>;
          })}
        </div>
      </div>
    </Modal>

    <ConfirmModal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={confirmDelete} loading={saving} title="删除定价模型" message={`删除 ${deleteTarget?.model || ""} 后，其显式映射也会被移除，并回退到默认定价。`} confirmText="删除" cancelText="取消" />
    <ConfirmModal isOpen={bulkConfirm} onClose={() => setBulkConfirm(false)} onConfirm={runBulkMapping} loading={saving} title="批量映射同名模型" message="系统将忽略大小写，自动映射所有尚未显式配置且与定价模型同名的提供商模型。已有手工映射不会被覆盖。" confirmText="开始映射" cancelText="取消" variant="primary" />
    <ConfirmModal isOpen={!!disableConfirm} onClose={() => setDisableConfirm(null)} onConfirm={confirmDisableModels} loading={saving} title="禁用模型" message={`确认禁用已选 ${disableConfirm?.items?.length || 0} 个模型？禁用后这些模型将不再对外提供。`} confirmText="禁用" cancelText="取消" variant="danger" />
  </div>;
}
