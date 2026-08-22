"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Modal, Toggle } from "@/shared/components";

const EMPTY_FORM = { id: null, name: "", allowAll: true, allowedModels: [], allowedCombos: [] };

export default function KeyGroupsPage() {
  const [groups, setGroups] = useState([]);
  const [models, setModels] = useState([]);
  const [combos, setCombos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);
  const [search, setSearch] = useState("");

  const loadData = async () => {
    setLoading(true);
    try {
      const [groupRes, modelRes, comboRes] = await Promise.all([
        fetch("/api/key-groups", { cache: "no-store" }),
        fetch("/api/v1/models", { cache: "no-store" }),
        fetch("/api/combos", { cache: "no-store" }),
      ]);
      const [groupData, modelData, comboData] = await Promise.all([groupRes.json(), modelRes.json(), comboRes.json()]);
      if (!groupRes.ok) throw new Error(groupData.error || "加载密钥分组失败");
      setGroups(groupData.groups || []);
      setModels((modelData.data || []).filter((model) => model.owned_by !== "combo").map((model) => model.id).sort());
      setCombos((comboData.combos || []).map((combo) => combo.name).sort());
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const openCreate = () => { setSearch(""); setForm({ ...EMPTY_FORM }); };
  const openEdit = (group) => {
    setSearch("");
    setForm({ id: group.id, name: group.name, allowAll: group.allowedModels.length === 0 && group.allowedCombos.length === 0, allowedModels: [...group.allowedModels], allowedCombos: [...group.allowedCombos] });
  };

  const saveGroup = async () => {
    if (!form.name.trim()) return alert("请输入分组名称");
    setSaving(true);
    try {
      const response = await fetch(form.id ? `/api/key-groups/${form.id}` : "/api/key-groups", {
        method: form.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), allowedModels: form.allowAll ? [] : form.allowedModels, allowedCombos: form.allowAll ? [] : form.allowedCombos }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存密钥分组失败");
      setForm(null);
      await loadData();
    } catch (error) {
      alert(error.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteGroup = async (group) => {
    if (!confirm(`删除密钥分组“${group.name}”？`)) return;
    const response = await fetch(`/api/key-groups/${group.id}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) return alert(data.error || "删除密钥分组失败");
    await loadData();
  };

  const toggleValue = (field, value) => setForm((current) => {
    const values = new Set(current[field]);
    values.has(value) ? values.delete(value) : values.add(value);
    return { ...current, [field]: [...values] };
  });

  const normalizedSearch = search.trim().toLowerCase();
  const visibleModels = useMemo(() => normalizedSearch ? models.filter((model) => model.toLowerCase().includes(normalizedSearch)) : models, [models, normalizedSearch]);
  const visibleCombos = useMemo(() => normalizedSearch ? combos.filter((combo) => combo.toLowerCase().includes(normalizedSearch)) : combos, [combos, normalizedSearch]);

  return (
    <div className="flex min-w-0 flex-col gap-4" data-i18n-skip>
      <div className="flex justify-end"><Button icon="add" onClick={openCreate}>新增分组</Button></div>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-border bg-surface-2 text-text-muted"><tr><th className="px-4 py-3 text-left">分组名称</th><th className="px-4 py-3 text-left">可用范围</th><th className="px-4 py-3 text-right">密钥数量</th><th className="px-4 py-3 text-right">操作</th></tr></thead>
            <tbody className="divide-y divide-border/60">
              {loading ? <tr><td colSpan={4} className="p-10 text-center text-text-muted">正在加载密钥分组...</td></tr> : groups.map((group) => {
                const unrestricted = group.allowedModels.length === 0 && group.allowedCombos.length === 0;
                return <tr key={group.id} className="hover:bg-surface-2/60"><td className="px-4 py-3"><div className="flex items-center gap-2 font-medium">{group.name}{group.isDefault && <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">默认</span>}</div></td><td className="px-4 py-3 text-text-muted">{unrestricted ? "全部模型" : `${group.allowedModels.length} 个模型，${group.allowedCombos.length} 个模型组合`}</td><td className="px-4 py-3 text-right tabular-nums">{group.keyCount}</td><td className="px-4 py-3 text-right"><button onClick={() => openEdit(group)} className="rounded-md p-2 text-text-muted hover:bg-surface-2 hover:text-primary" title="编辑"><span className="material-symbols-outlined text-[18px]">edit</span></button><button disabled={group.isDefault || group.keyCount > 0} onClick={() => deleteGroup(group)} className="rounded-md p-2 text-red-500 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-30" title={group.isDefault ? "默认分组不能删除" : group.keyCount > 0 ? "仍有密钥使用该分组" : "删除"}><span className="material-symbols-outlined text-[18px]">delete</span></button></td></tr>;
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal isOpen={!!form} onClose={() => setForm(null)} title={form?.id ? "编辑密钥分组" : "新增密钥分组"} size="full" footer={<><Button variant="ghost" onClick={() => setForm(null)}>取消</Button><Button loading={saving} onClick={saveGroup}>保存</Button></>}>
        {form && <div className="flex flex-col gap-5">
          <Input label="分组名称" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：开发环境" />
          <div className="flex items-center justify-between rounded-md border border-border p-3"><div><p className="text-sm font-medium">允许全部模型</p><p className="text-xs text-text-muted">开启后，该分组可获取并使用所有模型和模型组合。</p></div><Toggle checked={form.allowAll} onChange={(checked) => setForm((current) => ({ ...current, allowAll: checked }))} /></div>
          {!form.allowAll && <>
            <Input icon="search" placeholder="搜索模型或模型组合" value={search} onChange={(event) => setSearch(event.target.value)} />
            <div className="grid gap-5 lg:grid-cols-2">
              <section><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">可用模型</h3><span className="text-xs text-text-muted">已选 {form.allowedModels.length}</span></div><div className="max-h-80 overflow-y-auto rounded-md border border-border p-2">{visibleModels.map((model) => <label key={model} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-surface-2"><input type="checkbox" checked={form.allowedModels.includes(model)} onChange={() => toggleValue("allowedModels", model)} /><span className="font-mono">{model}</span></label>)}</div></section>
              <section><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">可用模型组合</h3><span className="text-xs text-text-muted">已选 {form.allowedCombos.length}</span></div><div className="max-h-80 overflow-y-auto rounded-md border border-border p-2">{visibleCombos.length ? visibleCombos.map((combo) => <label key={combo} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-surface-2"><input type="checkbox" checked={form.allowedCombos.includes(combo)} onChange={() => toggleValue("allowedCombos", combo)} /><span className="font-mono">{combo}</span></label>) : <p className="p-4 text-center text-xs text-text-muted">没有模型组合</p>}</div></section>
            </div>
          </>}
        </div>}
      </Modal>
    </div>
  );
}
