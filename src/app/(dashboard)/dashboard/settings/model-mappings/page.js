"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, DropdownSelect, Input, Modal } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { deriveMappedModelName } from "@/shared/utils/modelMapping.js";

const PAGE_SIZES = [25, 50, 100];

export default function ModelMappingsPage() {
  const notify = useNotificationStore();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState("");
  const [upstreamSearch, setUpstreamSearch] = useState("");
  const [mappedSearch, setMappedSearch] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchName, setBatchName] = useState("");
  const [editing, setEditing] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/model-mappings", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "加载模型映射失败");
      setItems(data.mappings || []);
    } catch (error) {
      notify.error(error.message || "加载模型映射失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const providers = useMemo(() => [...new Map(items.map((item) => [item.provider, item.providerName])).entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label)), [items]);
  const filtered = useMemo(() => items.filter((item) =>
    (!provider || item.provider === provider)
    && (!upstreamSearch.trim() || item.upstreamModel.toLowerCase().includes(upstreamSearch.trim().toLowerCase()))
    && (!mappedSearch.trim() || item.mappedModel.toLowerCase().includes(mappedSearch.trim().toLowerCase()))
  ), [items, provider, upstreamSearch, mappedSearch]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visibleItems = filtered.slice((page - 1) * pageSize, page * pageSize);
  const visibleIds = visibleItems.map((item) => item.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  useEffect(() => { setPage(1); }, [provider, upstreamSearch, mappedSearch, pageSize]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const saveMappings = async (mappings, successMessage) => {
    setSaving(true);
    try {
      const response = await fetch("/api/model-mappings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mappings }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存模型映射失败");
      await load();
      setSelected(new Set());
      notify.success(successMessage || `已更新 ${data.updated} 个模型映射`);
      return true;
    } catch (error) {
      notify.error(error.message || "保存模型映射失败");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const selectedItems = items.filter((item) => selected.has(item.id));
  const toggleVisible = () => setSelected((current) => {
    const next = new Set(current);
    for (const id of visibleIds) allVisibleSelected ? next.delete(id) : next.add(id);
    return next;
  });
  const applyBatchName = async () => {
    const mappedModel = batchName.trim();
    if (!mappedModel) return notify.warning("请输入批量映射名称");
    if (await saveMappings(selectedItems.map((item) => ({ ...item, mappedModel })))) {
      setBatchOpen(false);
      setBatchName("");
    }
  };
  const deriveSelectedNames = () => saveMappings(selectedItems.map((item) => ({
    ...item,
    mappedModel: deriveMappedModelName(item.upstreamModel),
  })), "已按最后一个 / 后的名称生成映射");
  const saveEditing = async () => {
    if (!editing?.mappedModel?.trim()) return notify.warning("映射模型名称不能为空");
    if (await saveMappings([editing], "模型映射已更新")) setEditing(null);
  };

  return (
    <div className="flex min-w-0 flex-col gap-4" data-i18n-skip>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <DropdownSelect label="提供商" value={provider} onChange={setProvider} searchable options={[{ value: "", label: "全部提供商" }, ...providers]} />
        <Input label="上游模型名称" icon="search" placeholder="模糊搜索上游模型" value={upstreamSearch} onChange={(event) => setUpstreamSearch(event.target.value)} />
        <Input label="映射模型名称" icon="search" placeholder="模糊搜索映射模型" value={mappedSearch} onChange={(event) => setMappedSearch(event.target.value)} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-muted">映射名称用于客户端模型列表、路由选择和流量统计；未配置时默认使用上游模型名称。</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon="drive_file_rename_outline" disabled={!selected.size} onClick={() => setBatchOpen(true)}>批量配置（{selected.size}）</Button>
          <Button icon="content_cut" disabled={!selected.size || saving} onClick={deriveSelectedNames}>取 / 后名称</Button>
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-border bg-surface-2 text-text-muted"><tr><th className="w-12 px-3 py-3"><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} aria-label="选择当前页" /></th><th className="px-3 py-3 text-left">提供商</th><th className="px-3 py-3 text-left">上游模型名称</th><th className="px-3 py-3 text-left">映射模型名称</th><th className="w-20 px-3 py-3 text-right">操作</th></tr></thead>
            <tbody className="divide-y divide-border/60">
              {loading ? <tr><td colSpan={5} className="p-10 text-center text-text-muted">正在加载模型映射...</td></tr> : !visibleItems.length ? <tr><td colSpan={5} className="p-10 text-center text-text-muted">没有匹配的模型</td></tr> : visibleItems.map((item) => (
                <tr key={item.id} className="hover:bg-surface-2/60">
                  <td className="px-3 py-2 text-center"><input type="checkbox" checked={selected.has(item.id)} onChange={() => setSelected((current) => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })} aria-label={`选择 ${item.upstreamModel}`} /></td>
                  <td className="px-3 py-2"><div className="font-medium">{item.providerName}</div><div className="text-xs text-text-muted">{item.provider}</div></td>
                  <td className="px-3 py-2 font-mono text-xs">{item.upstreamModel}</td>
                  <td className="px-3 py-2 font-mono text-xs text-primary">{item.mappedModel}</td>
                  <td className="px-3 py-2 text-right"><button className="rounded-md p-2 text-text-muted hover:bg-surface-2 hover:text-primary" title="编辑映射" onClick={() => setEditing({ ...item })}><span className="material-symbols-outlined text-[18px]">edit</span></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-sm text-text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>共 {filtered.length} 个模型</span>
          <div className="flex flex-wrap items-center gap-2"><label>每页 <select className="rounded-md border border-border bg-surface px-2 py-1" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select></label><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} icon="chevron_left" aria-label="上一页" /><span>{page} / {totalPages}</span><Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} icon="chevron_right" aria-label="下一页" /></div>
        </div>
      </Card>

      <Modal isOpen={batchOpen} onClose={() => setBatchOpen(false)} title={`批量配置 · 已选 ${selected.size} 个模型`} footer={<><Button variant="ghost" onClick={() => setBatchOpen(false)}>取消</Button><Button loading={saving} onClick={applyBatchName}>应用</Button></>}><Input label="映射模型名称" value={batchName} onChange={(event) => setBatchName(event.target.value)} placeholder="为选中模型设置同一名称" /></Modal>
      <Modal isOpen={!!editing} onClose={() => setEditing(null)} title="编辑模型映射" footer={<><Button variant="ghost" onClick={() => setEditing(null)}>取消</Button><Button loading={saving} onClick={saveEditing}>保存</Button></>}><div className="flex flex-col gap-4"><div className="rounded-md border border-border bg-surface-2 p-3 text-sm"><div className="text-text-muted">上游模型名称</div><div className="mt-1 break-all font-mono text-xs">{editing?.upstreamModel}</div></div><Input label="映射模型名称" value={editing?.mappedModel || ""} onChange={(event) => setEditing((current) => ({ ...current, mappedModel: event.target.value }))} /></div></Modal>
    </div>
  );
}
