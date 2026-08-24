"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, DropdownSelect, Input, Modal, Toggle } from "@/shared/components";
import { ConfirmModal } from "@/shared/components/Modal";
import { useNotificationStore } from "@/store/notificationStore";

const FIELDS = [
  ["input", "输入 Token"],
  ["output", "输出 Token"],
  ["cached", "缓存读取"],
  ["cache_creation", "缓存写入"],
  ["reasoning", "推理 Token"],
];
const EMPTY_RATES = Object.fromEntries(FIELDS.map(([field]) => [field, ""]));
const EMPTY_VALUES = { ...EMPTY_RATES, peakEnabled: false, peakWindows: "", peakPricing: { ...EMPTY_RATES }, offPeakPricing: { ...EMPTY_RATES } };

function RateFields({ values, onChange, emptyHint = "0" }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{FIELDS.map(([field, label]) => <Input key={field} label={`${label}（美元/百万 Token）`} type="number" min="0" step="0.000001" value={values[field] ?? ""} placeholder={emptyHint} onChange={(event) => onChange(field, event.target.value)} />)}</div>;
}

function PricingForm({ values, onChange, batch = false }) {
  const peakMode = batch ? values.peakEnabled : (values.peakEnabled ? "true" : "false");
  return <div className="flex flex-col gap-5">
    <div><p className="mb-3 text-sm font-semibold">基础定价</p><RateFields values={values} onChange={onChange} emptyHint={batch ? "留空则不修改" : "0"} /></div>
    <div className="border-t border-border pt-4">
      <div className="flex items-center justify-between gap-4"><div><p className="text-sm font-semibold">峰谷定价</p><p className="text-xs text-text-muted">按中国时间判断，支持多个时段。</p></div>{batch ? <DropdownSelect className="w-32" buttonClassName="h-10" value={peakMode} options={[{ value: "", label: "不修改" }, { value: "true", label: "启用" }, { value: "false", label: "关闭" }]} onChange={(value) => onChange("peakEnabled", value)} /> : <Toggle checked={values.peakEnabled === true} onChange={(checked) => onChange("peakEnabled", checked)} />}</div>
      {(peakMode === true || peakMode === "true") && <div className="mt-4 flex flex-col gap-4">
        <Input label="峰时时段（中国时间）" value={values.peakWindows || ""} placeholder="例如：09:00-12:00,14:00-18:00" onChange={(event) => onChange("peakWindows", event.target.value)} />
        <div><p className="mb-3 text-sm font-semibold text-red-500">峰时定价</p><RateFields values={values.peakPricing || EMPTY_RATES} onChange={(field, value) => onChange("peakPricing", { ...(values.peakPricing || {}), [field]: value })} emptyHint={batch ? "留空则不修改" : "0"} /></div>
        <div><p className="mb-3 text-sm font-semibold text-emerald-600">谷时定价</p><RateFields values={values.offPeakPricing || EMPTY_RATES} onChange={(field, value) => onChange("offPeakPricing", { ...(values.offPeakPricing || {}), [field]: value })} emptyHint={batch ? "留空则不修改" : "0"} /></div>
      </div>}
    </div>
  </div>;
}

const toNumberRates = (values, keepEmpty = false) => Object.fromEntries(FIELDS.flatMap(([field]) => keepEmpty && values?.[field] === "" ? [] : [[field, Number(values?.[field] || 0)]]));
const itemKey = (item) => `${item.provider}\u0000${item.model}`;

export default function PricingSettingsPage() {
  const notify = useNotificationStore();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState(new Set());
  const [editing, setEditing] = useState(null);
  const [editValues, setEditValues] = useState(EMPTY_VALUES);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchValues, setBatchValues] = useState({ ...EMPTY_VALUES, peakEnabled: "" });
  const [deleteTargets, setDeleteTargets] = useState([]);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadPricing = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/pricing", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "加载模型定价失败");
      setItems(data.items || []);
    } catch (error) { notify.error(error.message || "加载模型定价失败"); } finally { setLoading(false); }
  };
  useEffect(() => { loadPricing(); }, []);

  const filtered = useMemo(() => {
    const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return terms.length ? items.filter((item) => terms.every((term) => `${item.provider} ${item.model}`.toLowerCase().includes(term))) : items;
  }, [items, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visibleItems = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => { setPage(1); }, [search, pageSize]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const savePayload = async (payload) => {
    setSaving(true);
    try {
      const response = await fetch("/api/pricing", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存定价失败");
      await loadPricing();
      return true;
    } catch (error) {
      notify.error(error.message || "保存定价失败");
      return false;
    } finally { setSaving(false); }
  };

  const openEdit = (item) => {
    setEditing(item);
    setEditValues({ ...Object.fromEntries(FIELDS.map(([field]) => [field, String(item.pricing[field] ?? 0)])), peakEnabled: item.pricing.peakEnabled === true, peakWindows: item.pricing.peakWindows || "", peakPricing: Object.fromEntries(FIELDS.map(([field]) => [field, String(item.pricing.peakPricing?.[field] ?? item.pricing[field] ?? 0)])), offPeakPricing: Object.fromEntries(FIELDS.map(([field]) => [field, String(item.pricing.offPeakPricing?.[field] ?? item.pricing[field] ?? 0)])) });
  };

  const saveEdit = async () => {
    if (editValues.peakEnabled && !editValues.peakWindows.trim()) return notify.warning("请填写峰时时段");
    const pricing = { ...toNumberRates(editValues), peakEnabled: editValues.peakEnabled === true, peakWindows: editValues.peakWindows.trim(), peakPricing: toNumberRates(editValues.peakPricing), offPeakPricing: toNumberRates(editValues.offPeakPricing) };
    if (await savePayload({ [editing.provider]: { [editing.model]: pricing } })) {
      setEditing(null);
      notify.success("模型定价已保存");
    }
  };

  const saveBatch = async () => {
    const baseChanges = toNumberRates(batchValues, true);
    const peakChanges = toNumberRates(batchValues.peakPricing, true);
    const offPeakChanges = toNumberRates(batchValues.offPeakPricing, true);
    if (!Object.keys(baseChanges).length && batchValues.peakEnabled === "" && !Object.keys(peakChanges).length && !Object.keys(offPeakChanges).length) return notify.warning("请至少配置一项定价");
    const payload = {};
    for (const item of items.filter((entry) => selected.has(itemKey(entry)))) {
      const next = { ...item.pricing, ...baseChanges };
      if (batchValues.peakEnabled !== "") next.peakEnabled = batchValues.peakEnabled === "true";
      if (batchValues.peakWindows) next.peakWindows = batchValues.peakWindows.trim();
      if (Object.keys(peakChanges).length) next.peakPricing = { ...(item.pricing.peakPricing || {}), ...peakChanges };
      if (Object.keys(offPeakChanges).length) next.offPeakPricing = { ...(item.pricing.offPeakPricing || {}), ...offPeakChanges };
      payload[item.provider] ||= {};
      payload[item.provider][item.model] = next;
    }
    if (await savePayload(payload)) {
      setBatchOpen(false);
      setBatchValues({ ...EMPTY_VALUES, peakEnabled: "" });
      setSelected(new Set());
      notify.success(`已更新 ${Object.keys(payload).reduce((total, provider) => total + Object.keys(payload[provider]).length, 0)} 个模型定价`);
    }
  };

  const confirmDelete = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/pricing", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ models: deleteTargets.map(({ provider, model }) => ({ provider, model })) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "删除模型定价失败");
      setDeleteTargets([]);
      setSelected(new Set());
      await loadPricing();
      notify.success("模型定价已删除");
    } catch (error) { notify.error(error.message || "删除模型定价失败"); } finally { setSaving(false); }
  };

  const syncPricing = async () => {
    setSyncing(true);
    try {
      const response = await fetch("/api/pricing/sync", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "从 OpenCode 更新定价失败");
      await loadPricing();
      notify.success(`已同步 ${data.updatedCount || 0} 个模型，跳过 ${data.skippedCount || 0} 个暂不支持的模型`);
    } catch (error) { notify.error(error.message || "从 OpenCode 更新定价失败"); } finally { setSyncing(false); }
  };

  const visibleKeys = visibleItems.map(itemKey);
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selected.has(key));
  const toggleVisible = () => setSelected((current) => { const next = new Set(current); for (const key of visibleKeys) allVisibleSelected ? next.delete(key) : next.add(key); return next; });

  return <div className="flex min-w-0 flex-col gap-4" data-i18n-skip>
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between"><Input icon="search" placeholder="搜索模型或提供商" value={search} onChange={(event) => setSearch(event.target.value)} className="w-full xl:max-w-md" /><div className="flex flex-wrap gap-2"><Button variant="secondary" icon="price_change" disabled={!selected.size} onClick={() => setBatchOpen(true)}>批量定价（{selected.size}）</Button><Button variant="secondary" icon="delete" disabled={!selected.size} onClick={() => setDeleteTargets(items.filter((item) => selected.has(itemKey(item))))}>批量删除</Button><Button icon="sync" loading={syncing} onClick={syncPricing}>从 OpenCode 官网更新</Button></div></div>
    <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-sm"><thead className="border-b border-border bg-surface-2 text-text-muted"><tr><th className="w-12 px-3 py-3"><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} aria-label="选择当前页" /></th><th className="px-3 py-3 text-left">提供商</th><th className="px-3 py-3 text-left">模型</th>{FIELDS.map(([, label]) => <th key={label} className="px-3 py-3 text-right">{label}</th>)}<th className="px-3 py-3 text-center">峰谷定价</th><th className="px-3 py-3 text-right">操作</th></tr></thead><tbody className="divide-y divide-border/60">{loading ? <tr><td colSpan={10} className="p-10 text-center text-text-muted">正在加载模型定价...</td></tr> : !visibleItems.length ? <tr><td colSpan={10} className="p-10 text-center text-text-muted">没有匹配的模型</td></tr> : visibleItems.map((item) => {
      const key = itemKey(item);
      return <tr key={key} className="hover:bg-surface-2/60"><td className="px-3 py-2 text-center"><input type="checkbox" checked={selected.has(key)} onChange={() => setSelected((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; })} aria-label={`选择 ${item.model}`} /></td><td className="px-3 py-2">{item.provider}</td><td className="px-3 py-2 font-mono text-xs">{item.model}</td>{FIELDS.map(([field]) => <td key={field} className="px-3 py-2 text-right tabular-nums">{Number(item.pricing[field] || 0).toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}</td>)}<td className="px-3 py-2 text-center">{item.pricing.peakEnabled ? <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-600" title={`中国时间 ${item.pricing.peakWindows}`}>已启用</span> : <span className="text-xs text-text-muted">未启用</span>}</td><td className="px-3 py-2 text-right"><button className="rounded-md p-2 text-text-muted hover:bg-surface-2 hover:text-primary" title="编辑定价" onClick={() => openEdit(item)}><span className="material-symbols-outlined text-[18px]">edit</span></button><button className="rounded-md p-2 text-text-muted hover:bg-red-500/10 hover:text-red-500" title="删除模型" onClick={() => setDeleteTargets([item])}><span className="material-symbols-outlined text-[18px]">delete</span></button></td></tr>;
    })}</tbody></table></div><div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-sm text-text-muted sm:flex-row sm:items-center sm:justify-between"><span>共 {filtered.length} 个模型</span><div className="flex flex-wrap items-center gap-2"><label>每页 <select className="rounded-md border border-border bg-surface px-2 py-1" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} icon="chevron_left" aria-label="上一页" /><span>{page} / {totalPages}</span><Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} icon="chevron_right" aria-label="下一页" /></div></div></Card>
    <Modal isOpen={!!editing} onClose={() => setEditing(null)} title={editing ? `编辑定价 · ${editing.model}` : "编辑定价"} size="xl" footer={<><Button variant="ghost" onClick={() => setEditing(null)}>取消</Button><Button loading={saving} onClick={saveEdit}>保存</Button></>}><PricingForm values={editValues} onChange={(field, value) => setEditValues((current) => ({ ...current, [field]: value }))} /></Modal>
    <Modal isOpen={batchOpen} onClose={() => setBatchOpen(false)} title={`批量定价 · 已选 ${selected.size} 个模型`} size="xl" footer={<><Button variant="ghost" onClick={() => setBatchOpen(false)}>取消</Button><Button loading={saving} onClick={saveBatch}>应用定价</Button></>}><PricingForm batch values={batchValues} onChange={(field, value) => setBatchValues((current) => ({ ...current, [field]: value }))} /></Modal>
    <ConfirmModal isOpen={deleteTargets.length > 0} onClose={() => setDeleteTargets([])} onConfirm={confirmDelete} loading={saving} title={deleteTargets.length > 1 ? `删除 ${deleteTargets.length} 个模型` : "删除模型定价"} message="删除后模型将从定价列表隐藏，OpenCode 批量更新不会重新加入。未配置定价的请求仍按系统默认值计算。" confirmText="删除" cancelText="取消" variant="danger" />
  </div>;
}
