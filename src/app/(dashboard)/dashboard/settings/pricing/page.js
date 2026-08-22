"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Modal } from "@/shared/components";

const FIELDS = [
  ["input", "输入 Token"],
  ["output", "输出 Token"],
  ["cached", "缓存读取"],
  ["cache_creation", "缓存写入"],
  ["reasoning", "推理 Token"],
];

const EMPTY_VALUES = Object.fromEntries(FIELDS.map(([field]) => [field, ""]));

function PricingForm({ values, onChange, batch = false }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {FIELDS.map(([field, label]) => (
        <Input
          key={field}
          label={`${label}（美元/百万 Token）`}
          type="number"
          min="0"
          step="0.000001"
          value={values[field] ?? ""}
          placeholder={batch ? "留空则不修改" : "0"}
          onChange={(event) => onChange(field, event.target.value)}
        />
      ))}
    </div>
  );
}

export default function PricingSettingsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState(new Set());
  const [editing, setEditing] = useState(null);
  const [editValues, setEditValues] = useState(EMPTY_VALUES);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchValues, setBatchValues] = useState(EMPTY_VALUES);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadPricing = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/pricing", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "加载模型定价失败");
      setItems(data.items || []);
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadPricing(); }, []);

  const filtered = useMemo(() => {
    const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return items;
    return items.filter((item) => terms.every((term) => `${item.provider} ${item.model}`.toLowerCase().includes(term)));
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
    } catch (error) {
      alert(error.message);
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (item) => {
    setEditing(item);
    setEditValues(Object.fromEntries(FIELDS.map(([field]) => [field, String(item.pricing[field] ?? 0)])));
  };

  const saveEdit = async () => {
    const pricing = Object.fromEntries(FIELDS.map(([field]) => [field, Number(editValues[field] || 0)]));
    await savePayload({ [editing.provider]: { [editing.model]: pricing } });
    setEditing(null);
  };

  const saveBatch = async () => {
    const changes = Object.fromEntries(FIELDS.filter(([field]) => batchValues[field] !== "").map(([field]) => [field, Number(batchValues[field])]));
    if (!Object.keys(changes).length) return alert("请至少填写一个定价字段");
    const payload = {};
    for (const item of items.filter((entry) => selected.has(`${entry.provider}\u0000${entry.model}`))) {
      payload[item.provider] ||= {};
      payload[item.provider][item.model] = { ...item.pricing, ...changes };
    }
    await savePayload(payload);
    setBatchOpen(false);
    setBatchValues(EMPTY_VALUES);
    setSelected(new Set());
  };

  const syncPricing = async () => {
    setSyncing(true);
    try {
      const response = await fetch("/api/pricing/sync", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "从 OpenCode 更新定价失败");
      await loadPricing();
    } catch (error) {
      alert(error.message);
    } finally {
      setSyncing(false);
    }
  };

  const visibleKeys = visibleItems.map((item) => `${item.provider}\u0000${item.model}`);
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selected.has(key));
  const toggleVisible = () => setSelected((current) => {
    const next = new Set(current);
    for (const key of visibleKeys) allVisibleSelected ? next.delete(key) : next.add(key);
    return next;
  });

  return (
    <div className="flex min-w-0 flex-col gap-4" data-i18n-skip>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Input icon="search" placeholder="搜索模型或提供商" value={search} onChange={(event) => setSearch(event.target.value)} className="w-full lg:max-w-md" />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon="price_change" disabled={!selected.size} onClick={() => setBatchOpen(true)}>批量定价（{selected.size}）</Button>
          <Button icon="sync" loading={syncing} onClick={syncPricing}>从 OpenCode 官网更新</Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-sm">
            <thead className="border-b border-border bg-surface-2 text-text-muted"><tr><th className="w-12 px-3 py-3"><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} aria-label="选择当前页" /></th><th className="px-3 py-3 text-left">提供商</th><th className="px-3 py-3 text-left">模型</th>{FIELDS.map(([, label]) => <th key={label} className="px-3 py-3 text-right">{label}</th>)}<th className="px-3 py-3 text-right">操作</th></tr></thead>
            <tbody className="divide-y divide-border/60">
              {loading ? <tr><td colSpan={9} className="p-10 text-center text-text-muted">正在加载模型定价...</td></tr> : !visibleItems.length ? <tr><td colSpan={9} className="p-10 text-center text-text-muted">没有匹配的模型</td></tr> : visibleItems.map((item) => {
                const key = `${item.provider}\u0000${item.model}`;
                return <tr key={key} className="hover:bg-surface-2/60"><td className="px-3 py-2 text-center"><input type="checkbox" checked={selected.has(key)} onChange={() => setSelected((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; })} aria-label={`选择 ${item.model}`} /></td><td className="px-3 py-2">{item.provider}</td><td className="px-3 py-2 font-mono text-xs">{item.model}</td>{FIELDS.map(([field]) => <td key={field} className="px-3 py-2 text-right tabular-nums">{Number(item.pricing[field] || 0).toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}</td>)}<td className="px-3 py-2 text-right"><button className="rounded-md p-2 text-text-muted hover:bg-surface-2 hover:text-primary" title="编辑定价" onClick={() => openEdit(item)}><span className="material-symbols-outlined text-[18px]">edit</span></button></td></tr>;
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-sm text-text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>共 {filtered.length} 个模型</span>
          <div className="flex flex-wrap items-center gap-2"><label>每页 <select className="rounded-md border border-border bg-surface px-2 py-1" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} icon="chevron_left" aria-label="上一页" /><span>{page} / {totalPages}</span><Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} icon="chevron_right" aria-label="下一页" /></div>
        </div>
      </Card>

      <Modal isOpen={!!editing} onClose={() => setEditing(null)} title={editing ? `编辑定价 · ${editing.model}` : "编辑定价"} size="lg" footer={<><Button variant="ghost" onClick={() => setEditing(null)}>取消</Button><Button loading={saving} onClick={saveEdit}>保存</Button></>}><PricingForm values={editValues} onChange={(field, value) => setEditValues((current) => ({ ...current, [field]: value }))} /></Modal>
      <Modal isOpen={batchOpen} onClose={() => setBatchOpen(false)} title={`批量定价 · 已选 ${selected.size} 个模型`} size="lg" footer={<><Button variant="ghost" onClick={() => setBatchOpen(false)}>取消</Button><Button loading={saving} onClick={saveBatch}>应用定价</Button></>}><PricingForm batch values={batchValues} onChange={(field, value) => setBatchValues((current) => ({ ...current, [field]: value }))} /></Modal>
    </div>
  );
}
