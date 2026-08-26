"use client";

import { useState, useEffect, useCallback } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { Card, Button, Modal, Input, CardSkeleton, ModelSelectModal, ConfirmModal, CapacityBadges, Select, Toggle, PopupMenu, PopupMenuItem } from "@/shared/components";
import { useRef } from "react";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { AI_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, resolveProviderId } from "@/shared/constants/providers";
import { useNotificationStore } from "@/store/notificationStore";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

// Capacity adapter: global fallback pools of models per input-modality capability.
// A request needing a capability the target model/combo lacks switches straight
// to the first enabled model here instead of erroring or dropping the data.
const CAPACITY_ADAPTER_CAPS = [
  { key: "vision", label: "Vision", icon: "visibility", desc: "Images" },
  // pdf, videoInput temporarily hidden — no translator support yet for those blocks.
  { key: "audioInput", label: "Audio", icon: "graphic_eq", desc: "Audio input" },
];
const DEFAULT_FALLBACK_MODEL = "oc/mimo-v2.5-free";
const EMPTY_CAP_ENTRY = { enabled: true, roundRobin: false, models: [] };
const EMPTY_CAPACITY_ADAPTER = {
  vision: { ...EMPTY_CAP_ENTRY },
  pdf: { ...EMPTY_CAP_ENTRY },
  audioInput: { ...EMPTY_CAP_ENTRY },
  videoInput: { ...EMPTY_CAP_ENTRY },
};
// Backward-compat: legacy stored form was an array of {model, enabled}.
function normalizeCapEntry(entry) {
  if (Array.isArray(entry)) {
    return { enabled: true, roundRobin: false, models: entry.map((e) => e?.model || e).filter(Boolean) };
  }
  if (entry && typeof entry === "object") {
    return {
      enabled: entry.enabled !== false,
      roundRobin: !!entry.roundRobin,
      models: Array.isArray(entry.models) ? entry.models.filter(Boolean) : [],
    };
  }
  return { ...EMPTY_CAP_ENTRY };
}

async function loadCombosPageData() {
  const [combosRes, providersRes, settingsRes, listsRes] = await Promise.all([
    fetch("/api/combos"),
    fetch("/api/providers"),
    fetch("/api/settings"),
    fetch("/api/combo-lists"),
  ]);
  const [combosData, providersData, settingsData, listsData] = await Promise.all([
    combosRes.json(),
    providersRes.json(),
    settingsRes.ok ? settingsRes.json() : {},
    listsRes.ok ? listsRes.json() : { lists: [] },
  ]);
  const rawAdapter = settingsData.capacityAdapter || {};
  const capacityAdapter = {};
  for (const cap of CAPACITY_ADAPTER_CAPS) {
    capacityAdapter[cap.key] = normalizeCapEntry(rawAdapter[cap.key]);
  }
  return {
    combos: combosRes.ok ? (combosData.combos || []).filter((combo) => !combo.kind || combo.kind === "llm") : null,
    activeProviders: providersRes.ok
      ? (providersData.connections || []).filter((connection) => connection.isActive !== false || connection.autoDisabled === true)
      : null,
    comboStrategies: settingsData.comboStrategies || {},
    capacityAdapter,
    lists: listsData.lists || [],
  };
}

// Normalize list name input: trim, length cap, duplicate rejection.
// Returns an error string or null when valid.
function validateListName(value, existingNames) {
  const name = value.trim();
  if (!name) return "清单名称不能为空";
  if (name.length > 50) return "清单名称不能超过 50 个字符";
  if (existingNames.includes(name)) return "同名清单已存在";
  return null;
}

export default function CombosPage() {
  const notify = useNotificationStore();
  const [combos, setCombos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCombo, setEditingCombo] = useState(null);
  const [activeProviders, setActiveProviders] = useState([]);
  const [comboStrategies, setComboStrategies] = useState({});
  const [capacityAdapter, setCapacityAdapter] = useState(EMPTY_CAPACITY_ADAPTER);
  const { getCaps } = useModelCaps();
  const [confirmState, setConfirmState] = useState(null);
  const { copied, copy } = useCopyToClipboard();

  // ── Combo lists (page-only organization) ──
  const [lists, setLists] = useState([]); // [{id, name, sortOrder, comboCount}]
  // Current tab: always the lowest-sortOrder list on entry — selection is not
  // persisted/shared across pages.
  const [activeListId, setActiveListId] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set()); // batch selection
  const [batchBusy, setBatchBusy] = useState(false);
  const [listMenuOpen, setListMenuOpen] = useState(false); // "清单管理" menu
  const [manageTarget, setManageTarget] = useState(null); // {mode: 'create'} | {mode:'rename', list}
  const [listNameDraft, setListNameDraft] = useState("");
  const [listNameError, setListNameError] = useState("");
  const [moveMenuFor, setMoveMenuFor] = useState(null); // combo id whose move-menu is open
  const moveBtnRefs = useRef({}); // combo id → button element (menu anchor)
  const batchMoveBtnRef = useRef(null);
  const manageBtnRef = useRef(null);

  const applyPageData = useCallback((data) => {
    if (data.combos) setCombos(data.combos);
    if (data.activeProviders) setActiveProviders(data.activeProviders);
    setComboStrategies(data.comboStrategies);
    setCapacityAdapter(data.capacityAdapter);
    if (data.lists) setLists(data.lists);
  }, []);

  // Drop selections that no longer point at combos in the current list.
  const pruneSelection = useCallback((currentListId) => {
    setSelectedIds((current) => {
      if (!current.size) return current;
      const validIds = new Set(combos.filter((c) => c.listId === currentListId).map((c) => c.id));
      const next = new Set([...current].filter((id) => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [combos]);

  const fetchData = useCallback(async () => {
    try {
      applyPageData(await loadCombosPageData());
    } catch (error) {
      console.log("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  }, [applyPageData]);

  useEffect(() => {
    let cancelled = false;
    loadCombosPageData()
      .then((data) => {
        if (cancelled) return;
        applyPageData(data);
        // Enter page on the first (lowest sortOrder) list; no persisted selection.
        setActiveListId((current) => current || [...data.lists].sort((a, b) => a.sortOrder - b.sortOrder)[0]?.id || "default");
      })
      .catch((error) => { if (!cancelled) console.log("Error fetching data:", error); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [applyPageData]);

  // Selections are pruned at the action sites (tab switch / delete / move
  // success) instead of an effect — no cascading renders.

  // ── List management handlers ──
  const openCreateList = () => {
    setManageTarget({ mode: "create" });
    setListNameDraft("");
    setListNameError("");
  };
  const openRenameList = (list) => {
    setManageTarget({ mode: "rename", list });
    setListNameDraft(list.name);
    setListNameError("");
  };

  const saveListName = async () => {
    const error = validateListName(listNameDraft, lists.map((l) => l.name).filter((n) => manageTarget?.mode !== "rename" || n !== manageTarget.list.name));
    if (error) return setListNameError(error);
    try {
      if (manageTarget.mode === "create") {
        const res = await fetch("/api/combo-lists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: listNameDraft.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "创建清单失败");
        setLists((current) => [...current, data.list]);
        setActiveListId(data.list.id); // jump into the freshly created list
      } else {
        const res = await fetch(`/api/combo-lists/${manageTarget.list.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: listNameDraft.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "重命名清单失败");
        setLists(data.lists);
      }
      setManageTarget(null);
      notify.success(manageTarget.mode === "create" ? "清单已创建" : "清单已重命名");
    } catch (error) {
      notify.error(error.message || "保存清单失败");
    }
  };

  const handleDeleteList = (list) => {
    setConfirmState({
      title: "删除清单",
      message: `删除“${list.name}”后，其中全部 ${list.comboCount ?? 0} 个模型组合将移动到默认清单，组合本身不会被删除。`,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/combo-lists/${list.id}`, { method: "DELETE" });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "删除清单失败");
          setLists(data.lists);
          if (activeListId === list.id) {
            setSelectedIds(new Set());
            setActiveListId("default"); // deleted current tab → fall back to default
          } else pruneSelection(activeListId);
          notify.success("清单已删除");
        } catch (error) {
          notify.error(error.message || "删除清单失败");
        }
      },
    });
  };

  // Move a list one slot up/down and persist the compacted order immediately.
  const handleMoveList = async (listId, delta) => {
    const ids = [...lists].sort((a, b) => a.sortOrder - b.sortOrder).map((l) => l.id);
    const from = ids.indexOf(listId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    const previous = lists;
    setLists((current) => [...current].sort((a, b) => {
      const ia = ids.indexOf(a.id), ib = ids.indexOf(b.id);
      return ia - ib;
    }));
    try {
      const res = await fetch("/api/combo-lists/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "排序失败");
      setLists(data.lists);
    } catch (error) {
      setLists(previous); // revert failed optimistic sort
      notify.error(error.message || "排序清单失败");
    }
  };

  // ── Combo move / batch ops ──
  const moveCombos = async (comboIds, targetListId) => {
    setBatchBusy(true);
    try {
      const res = await fetch("/api/combos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "move", ids: comboIds, listId: targetListId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "转移组合失败");
      setCombos(data.combos);
      // 清理选区：移出当前清单的组合不再处于选中状态。
      setSelectedIds((current) => targetListId === activeListId ? current : new Set([...current].filter((id) => !data.movedIds.includes(id))));
      const targetName = lists.find((l) => l.id === targetListId)?.name || "";
      notify.success(`已转移 ${data.movedIds.length} 个组合到「${targetName}」`);
    } catch (error) {
      notify.error(error.message || "转移组合失败");
    } finally {
      setBatchBusy(false);
    }
  };

  const deleteCombosBatch = (ids) => {
    setConfirmState({
      title: "批量删除模型组合",
      message: `确定删除选中的 ${ids.length} 个模型组合？此操作不可撤销。`,
      onConfirm: async () => {
        setConfirmState(null);
        setBatchBusy(true);
        try {
          const res = await fetch("/api/combos", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete", ids }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "批量删除失败");
          setCombos(data.combos);
          setSelectedIds(new Set());
          notify.success(`已删除 ${data.deletedIds.length} 个模型组合`);
        } catch (error) {
          notify.error(error.message || "批量删除失败");
        } finally {
          setBatchBusy(false);
        }
      },
    });
  };

  const toggleSelectCombo = (comboId) => setSelectedIds((current) => {
    const next = new Set(current);
    next.has(comboId) ? next.delete(comboId) : next.add(comboId);
    return next;
  });

  const handleSetCapacityAdapter = async (next) => {
    setCapacityAdapter(next);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capacityAdapter: next }),
      });
    } catch (error) {
      console.log("Error updating capacity adapter:", error);
    }
  };

  const handleCreate = async (data) => {
    try {
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, listId: activeListId || "default" }), // new combo joins current tab's list
      });
      if (res.ok) {
        await fetchData();
        setShowCreateModal(false);
      } else {
        const err = await res.json();
        notify.error(err.error || "创建模型组合失败");
      }
    } catch (error) {
      console.log("Error creating combo:", error);
    }
  };

  const handleUpdate = async (id, data) => {
    try {
      const res = await fetch(`/api/combos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setEditingCombo(null);
      } else {
        const err = await res.json();
        notify.error(err.error || "更新模型组合失败");
      }
    } catch (error) {
      console.log("Error updating combo:", error);
    }
  };

  const handleDelete = async (id) => {
    setConfirmState({
      title: "Delete Combo",
      message: "Delete this combo?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
          if (res.ok) {
            setCombos(combos.filter(c => c.id !== id));
          }
        } catch (error) {
          console.log("Error deleting combo:", error);
        }
      }
    });
  };

  // Merge a per-combo strategy patch into settings.comboStrategies. Passing an empty
  // patch (strategy back to default "fallback") drops the entry entirely.
  const handleSetComboStrategy = async (comboName, patch) => {
    try {
      const updated = { ...comboStrategies };
      const next = { ...(updated[comboName] || {}), ...patch };
      // Prune to keep settings clean: default fallback with no extras = no entry.
      if (!next.fallbackStrategy || next.fallbackStrategy === "fallback") {
        delete updated[comboName];
      } else {
        updated[comboName] = next;
      }

      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboStrategies: updated }),
      });

      setComboStrategies(updated);
    } catch (error) {
      console.log("Error updating combo strategy:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const sortedLists = [...lists].sort((a, b) => a.sortOrder - b.sortOrder);
  const currentList = sortedLists.find((l) => l.id === activeListId);
  // Combos shown in the current tab only (list-scoped view).
  const listCombos = activeListId ? combos.filter((c) => c.listId === activeListId) : [];

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Tab bar: list tabs left; "清单管理" + "新建模型组合" right */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1" role="tablist" aria-label="模型组合清单">
          {sortedLists.map((list) => (
            <button
              key={list.id}
              type="button"
              role="tab"
              aria-selected={list.id === activeListId}
              title={`${list.name} · ${list.comboCount ?? combos.filter((c) => c.listId === list.id).length} 个组合`}
              onClick={() => { setActiveListId(list.id); pruneSelection(list.id); }}
              className={`max-w-[180px] truncate rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                list.id === activeListId
                  ? "bg-primary/10 text-primary"
                  : "text-text-muted hover:bg-black/5 hover:text-text-main dark:hover:bg-white/5"
              }`}
            >
              {list.name}{" "}
              <span className="text-xs opacity-70">{list.comboCount ?? combos.filter((c) => c.listId === list.id).length}</span>
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span ref={manageBtnRef} className="inline-flex">
            <Button variant="secondary" size="sm" icon="format_list_bulleted" aria-haspopup="menu" aria-expanded={listMenuOpen} onClick={() => setListMenuOpen((v) => !v)}>
              清单管理
            </Button>
          </span>
          <Button icon="add" onClick={() => setShowCreateModal(true)}>
            新建模型组合
          </Button>
        </div>
      </div>

      {/* Batch action bar: slides in between tabs and the list when ≥1 selected */}
      <div
        className={`overflow-hidden transition-all duration-200 ${selectedIds.size > 0 ? "max-h-16 opacity-100" : "max-h-0 opacity-0"}`}
        aria-hidden={selectedIds.size === 0}
      >
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-2/60 px-4 py-2.5 slide-in-top">
          <span className="text-sm font-medium">已选 {selectedIds.size} 个组合</span>
          <span ref={batchMoveBtnRef} className="ml-auto inline-flex">
            <Button size="sm" variant="secondary" icon="drive_file_move" aria-haspopup="menu" aria-expanded={moveMenuFor === "__batch__"} disabled={batchBusy || !sortedLists.some((l) => l.id !== activeListId)} onClick={() => setMoveMenuFor("__batch__")}>
              转移
            </Button>
          </span>
          <Button
            size="sm"
            variant="danger"
            icon="delete"
            disabled={batchBusy}
            onClick={() => deleteCombosBatch([...selectedIds])}
          >
            删除
          </Button>
        </div>
      </div>

      {/* Batch move menu — portal; anchored to the batch bar's 转移 button */}
      <BatchMoveMenu
        open={moveMenuFor === "__batch__"}
        onClose={() => setMoveMenuFor(null)}
        anchorRef={batchMoveBtnRef}
        lists={sortedLists.filter((l) => l.id !== activeListId)}
        activeListId={activeListId}
        onPick={(targetId) => { setMoveMenuFor(null); moveCombos([...selectedIds], targetId); }}
      />

      {/* Combos List — scoped to the current tab's list */}
      {listCombos.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
              <span className="material-symbols-outlined text-[32px]">layers</span>
            </div>
            <p className="text-text-main font-medium mb-1">「{currentList?.name || "当前清单"}」暂无模型组合</p>
            <p className="text-sm text-text-muted mb-4">新建的组合将归入此清单；也可从其他清单转移组合过来</p>
            <Button icon="add" onClick={() => setShowCreateModal(true)} className="w-full sm:w-auto">
              新建模型组合
            </Button>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {listCombos.map((combo) => (
            <ComboCard
              key={combo.id}
              combo={combo}
              getCaps={getCaps}
              activeProviders={activeProviders}
              copied={copied}
              onCopy={copy}
              selected={selectedIds.has(combo.id)}
              onToggleSelect={() => toggleSelectCombo(combo.id)}
              onEdit={() => setEditingCombo(combo)}
              onDelete={() => handleDelete(combo.id)}
              onMoveToList={(targetId) => moveCombos([combo.id], targetId)}
              lists={sortedLists.filter((l) => l.id !== activeListId)}
              moveMenuOpen={moveMenuFor === combo.id}
              onMoveMenuOpenChange={(open) => setMoveMenuFor(open ? combo.id : null)}
              strategy={comboStrategies[combo.name] || {}}
              onSetStrategy={(patch) => handleSetComboStrategy(combo.name, patch)}
            />
          ))}
        </div>
      )}

      {/* 清单管理 menu (portal, anchored to its trigger button) */}
      <ListManageMenu
        open={listMenuOpen}
        onClose={() => setListMenuOpen(false)}
        triggerRef={manageBtnRef}
        lists={sortedLists}
        onCreate={openCreateList}
        onRename={openRenameList}
        onDelete={handleDeleteList}
        onMove={(id, delta) => handleMoveList(id, delta)}
      />

      {/* Capacity Adapter */}
      <CapacityAdapterSection
        capacityAdapter={capacityAdapter}
        onChange={handleSetCapacityAdapter}
        activeProviders={activeProviders}
        getCaps={getCaps}
      />

      {/* Create Modal - Use key to force remount and reset state */}
      {showCreateModal && (
        <ComboFormModal
          key="create"
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSave={handleCreate}
          activeProviders={activeProviders}
        />
      )}

      {editingCombo && (
        <ComboFormModal
          key={editingCombo.id}
          isOpen={!!editingCombo}
          combo={editingCombo}
          onClose={() => setEditingCombo(null)}
          onSave={(data) => handleUpdate(editingCombo.id, data)}
          activeProviders={activeProviders}
        />
      )}

      {/* Create/rename list modal */}
      <Modal
        isOpen={!!manageTarget}
        onClose={() => setManageTarget(null)}
        title={manageTarget?.mode === "create" ? "新建清单" : "重命名清单"}
        size="sm"
      >
        <div className="flex flex-col gap-3">
          <Input
            label="清单名称"
            value={listNameDraft}
            autoFocus
            onChange={(e) => { setListNameDraft(e.target.value); setListNameError(""); }}
            onKeyDown={(e) => e.key === "Enter" && saveListName()}
            placeholder="例如：编码、写作"
            error={listNameError}
            maxLength={50}
          />
          <div className="flex gap-2">
            <Button variant="ghost" fullWidth size="sm" onClick={() => setManageTarget(null)}>取消</Button>
            <Button fullWidth size="sm" onClick={saveListName} disabled={!listNameDraft.trim() || !!listNameError}>保存</Button>
          </div>
        </div>
      </Modal>

      {/* Confirm Delete Modal */}
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />
    </div>
  );
}

// Portal menu for managing lists: create / rename / delete / move up / move down.
function ListManageMenu({ open, onClose, triggerRef, lists, onCreate, onRename, onDelete, onMove }) {
  return (
    <PopupMenu open={open} onClose={onClose} triggerRef={triggerRef} minWidth={260} className="max-h-[70vh] overflow-y-auto custom-scrollbar">
      {() => (
        <div className="p-1">
          <button
            type="button"
            role="menuitem"
            onClick={() => { onClose(); onCreate(); }}
            className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm text-primary hover:bg-primary/10"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            新建清单
          </button>
          {lists.map((list, index) => (
            <div key={list.id} className="mt-0.5 border-t border-border/60 pt-1 first:border-0 first:pt-0">
              <div className="flex items-center justify-between gap-1 px-2.5 py-1">
                <span className="min-w-0 truncate text-sm font-medium" title={list.name}>{list.name}</span>
                <div className="flex shrink-0 items-center">
                  <ListIconBtn label="上移" icon="arrow_upward" disabled={index === 0} onClick={() => onMove(list.id, -1)} />
                  <ListIconBtn label="下移" icon="arrow_downward" disabled={index === lists.length - 1} onClick={() => onMove(list.id, 1)} />
                  <ListIconBtn label="重命名" icon="edit" onClick={() => { onClose(); onRename(list); }} />
                  {list.id !== "default" ? (
                    <ListIconBtn label="删除" icon="delete" onClick={() => { onClose(); onDelete(list); }} className="hover:text-red-500" />
                  ) : (
                    <ListIconBtn label="默认清单不能删除" icon="lock" disabled className="text-text-muted/30" />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </PopupMenu>
  );
}

function ListIconBtn({ label, icon, disabled, onClick, className }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`rounded p-1 text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5 disabled:cursor-not-allowed ${className || ""}`}
    >
      <span className="material-symbols-outlined text-[16px]">{icon}</span>
    </button>
  );
}

// Move-target menu. Two anchoring modes:
// - anchorRef given (batch bar): menu anchors to the external trigger element.
// - no anchorRef (per-row): renders its own icon button and anchors to it.
function BatchMoveMenu({ open, onClose, anchorRef, lists, activeListId, onPick }) {
  void activeListId;
  const internalRef = useRef(null);
  const btnRef = anchorRef || internalRef;
  return (
    <PopupMenu open={open} onClose={onClose} triggerRef={btnRef} minWidth={200}>
      {() => (
        <div role="listbox" className="max-h-60 overflow-y-auto p-1 custom-scrollbar">
          {lists.length ? lists.map((list) => (
            <PopupMenuItem key={list.id} active={false} onClick={() => onPick(list.id)}>
              <span className="truncate">{list.name}</span>
            </PopupMenuItem>
          )) : <p className="px-3 py-4 text-center text-xs text-text-muted">没有其他清单</p>}
        </div>
      )}
    </PopupMenu>
  );
}

const STRATEGY_OPTIONS = [
  { value: "fallback", label: "Fallback — try in order" },
  { value: "round-robin", label: "Round Robin — rotate" },
  { value: "fusion", label: "Fusion — panel + judge" },
];

function ComboCard({
  combo, getCaps, activeProviders = [], copied, onCopy,
  selected, onToggleSelect, onEdit, onDelete,
  lists = [], moveMenuOpen, onMoveMenuOpenChange, onMoveToList,
  strategy = {}, onSetStrategy,
}) {
  const [showJudgeSelect, setShowJudgeSelect] = useState(false);
  const current = strategy.fallbackStrategy || "fallback";
  const judge = strategy.judgeModel || "";
  const isFusion = current === "fusion";
  const moveBtnRef = useRef(null);

  return (
    <Card padding="sm" className={`group ${selected ? "ring-1 ring-primary/40" : ""}`}>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          {/* Row selection checkbox */}
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`选择组合 ${combo.name}`}
            className="mt-1 shrink-0 sm:mt-0"
          />
          <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-primary text-[18px]">layers</span>
          </div>
          <div className="min-w-0 flex-1">
            <code className="block truncate font-mono text-sm font-medium">{combo.name}</code>
            {combo.description && <p className="mt-1 line-clamp-2 text-xs text-text-muted" title={combo.description}>{combo.description}</p>}
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
              {combo.models.length === 0 ? (
                <span className="text-xs text-text-muted italic">No models</span>
              ) : (
                combo.models.slice(0, 3).map((model, index) => (
                  <code key={index} className="inline-flex items-center gap-1 rounded bg-black/5 px-1.5 py-0.5 font-mono text-xs text-text-muted dark:bg-white/5">
                    <span>{model}</span>
                    <CapacityBadges caps={getCaps?.(model)} />
                  </code>
                ))
              )}
              {combo.models.length > 3 && (
                <span className="text-[10px] text-text-muted">+{combo.models.length - 3} more</span>
              )}
            </div>
            {/* Fusion: judge picker (Auto = first model) */}
            {isFusion && (
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-text-muted">Judge</span>
                <button
                  onClick={() => setShowJudgeSelect(true)}
                  className="inline-flex max-w-full items-center gap-1 rounded border border-dashed border-primary/40 px-1.5 py-0.5 font-mono text-[11px] text-primary hover:border-primary hover:bg-primary/5 transition-colors"
                  title="Pick the model that fuses panel answers"
                >
                  <span className="material-symbols-outlined text-[13px]">gavel</span>
                  <span className="truncate">{judge || `Auto — ${combo.models[0] || "first model"}`}</span>
                </button>
                {judge && (
                  <button
                    onClick={() => onSetStrategy({ judgeModel: "" })}
                    className="p-0.5 rounded text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
                    title="Reset judge to Auto"
                  >
                    <span className="material-symbols-outlined text-[13px]">close</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3 sm:shrink-0">
          {/* Strategy selector — always visible */}
          <div className="w-full sm:w-[200px]">
            <Select
              options={STRATEGY_OPTIONS}
              value={current}
              onChange={(e) => onSetStrategy({ fallbackStrategy: e.target.value })}
              selectClassName="py-1.5 text-xs"
            />
          </div>

          <div className="grid grid-cols-4 gap-1 sm:flex">
            {/* 转移至清单 */}
            <button
              ref={moveBtnRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={moveMenuOpen}
              aria-label={`转移组合 ${combo.name} 至其他清单`}
              onClick={() => onMoveMenuOpenChange(!moveMenuOpen)}
              className={`flex flex-col items-center rounded px-2 py-1 transition-colors ${moveMenuOpen ? "bg-primary/10 text-primary" : "text-text-muted hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"}`}
              title="转移至清单"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <span className="material-symbols-outlined text-[18px]">drive_file_move</span>
              <span className="text-[10px] leading-tight">转移</span>
            </button>
            <BatchMoveMenu
              open={moveMenuOpen}
              onClose={() => onMoveMenuOpenChange(false)}
              anchorRef={moveBtnRef}
              lists={lists}
              activeListId={combo.listId}
              onPick={(targetId) => { onMoveMenuOpenChange(false); onMoveToList(targetId); }}
            />
            <button
              onClick={(e) => { e.stopPropagation(); onCopy(combo.name, `combo-${combo.id}`); }}
              className="flex flex-col items-center rounded px-2 py-1 text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
              title="Copy combo name"
            >
              <span className="material-symbols-outlined text-[18px]">
                {copied === `combo-${combo.id}` ? "check" : "content_copy"}
              </span>
              <span className="text-[10px] leading-tight">Copy</span>
            </button>
            <button
              onClick={onEdit}
              className="flex flex-col items-center rounded px-2 py-1 text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
              title="Edit"
            >
              <span className="material-symbols-outlined text-[18px]">edit</span>
              <span className="text-[10px] leading-tight">Edit</span>
            </button>
            <button
              onClick={onDelete}
              className="flex flex-col items-center rounded px-2 py-1 text-red-500 transition-colors hover:bg-red-500/10"
              title="Delete"
            >
              <span className="material-symbols-outlined text-[18px]">delete</span>
              <span className="text-[10px] leading-tight">Delete</span>
            </button>
          </div>
        </div>
      </div>

      {/* Judge model picker (single-select; combo members make natural judges too) */}
      {showJudgeSelect && (
        <ModelSelectModal
          isOpen={showJudgeSelect}
          onClose={() => setShowJudgeSelect(false)}
          onSelect={(m) => { onSetStrategy({ judgeModel: m?.value || "" }); setShowJudgeSelect(false); }}
          activeProviders={activeProviders}
          title="Select Judge Model"
          addedModelValues={judge ? [judge] : []}
          closeOnSelect={true}
        />
      )}
    </Card>
  );
}

function CapacityAdapterSection({ capacityAdapter, onChange, activeProviders, getCaps }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">Vision Adapter</p>
          <p className="text-xs text-text-muted mt-0.5">
            Your model can&apos;t read image/audio? Auto-switches to a model in the pool below.
          </p>
          <ul className="mt-1.5 text-[11px] text-text-muted flex flex-col gap-0.5">
            <li><span className="font-medium text-text-main">Vision</span> — images (png, jpg, webp, …)</li>
            <li><span className="font-medium text-text-main">Audio</span> — audio input</li>
          </ul>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        {CAPACITY_ADAPTER_CAPS.map((cap) => (
          <CapacityAdapterCap
            key={cap.key}
            cap={cap}
            entry={capacityAdapter[cap.key] || EMPTY_CAP_ENTRY}
            onChange={(entry) => onChange({ ...capacityAdapter, [cap.key]: entry })}
            activeProviders={activeProviders}
            getCaps={getCaps}
          />
        ))}
      </div>
    </div>
  );
}

function CapacityAdapterCap({ cap, entry, onChange, activeProviders, getCaps }) {
  const [showModelSelect, setShowModelSelect] = useState(false);
  const { enabled, roundRobin, models } = entry;

  const patch = (p) => onChange({ ...entry, ...p });

  const handleAdd = (model) => {
    if (models.includes(model.value)) return;
    patch({ models: [...models, model.value] });
  };

  const handleRemove = (index) => {
    const next = models.filter((_, i) => i !== index);
    patch({ models: next.length === 0 ? [DEFAULT_FALLBACK_MODEL] : next });
  };

  const handleMove = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= models.length) return;
    const next = [...models];
    [next[index], next[target]] = [next[target], next[index]];
    patch({ models: next });
  };

  return (
    <Card padding="sm" className={`group ${!enabled ? "opacity-50" : ""}`}>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Master toggle + icon + label + chips */}
        <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:items-center">
          <Toggle
            checked={enabled}
            onChange={(v) => patch({ enabled: v })}
            aria-label={`Enable ${cap.label} adapter`}
          />
          <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-primary text-[18px]">{cap.icon}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <code className="font-mono text-sm font-medium">{cap.label}</code>
              <span className="text-[10px] text-text-muted">— {cap.desc}</span>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
              {models.length === 0 ? (
                <span className="text-xs text-text-muted italic">No models</span>
              ) : (
                models.slice(0, 3).map((model, index) => (
                  <code
                    key={`${model}-${index}`}
                    className="group/chip inline-flex items-center gap-1 rounded bg-black/5 px-1.5 py-0.5 font-mono text-xs text-text-muted dark:bg-white/5"
                  >
                    <span>{model}</span>
                    <CapacityBadges caps={getCaps?.(model)} />
                    <button onClick={() => handleMove(index, -1)} disabled={index === 0} className={`leading-none opacity-0 group-hover/chip:opacity-100 ${index === 0 ? "text-text-muted/20" : "text-text-muted hover:text-primary"}`}>
                      <span className="material-symbols-outlined text-[12px]">arrow_upward</span>
                    </button>
                    <button onClick={() => handleMove(index, 1)} disabled={index === models.length - 1} className={`leading-none opacity-0 group-hover/chip:opacity-100 ${index === models.length - 1 ? "text-text-muted/20" : "text-text-muted hover:text-primary"}`}>
                      <span className="material-symbols-outlined text-[12px]">arrow_downward</span>
                    </button>
                    <button onClick={() => handleRemove(index)} className="leading-none opacity-0 group-hover/chip:opacity-100 text-text-muted hover:text-red-500">
                      <span className="material-symbols-outlined text-[12px]">close</span>
                    </button>
                  </code>
                ))
              )}
              {models.length > 3 && (
                <span className="text-[10px] text-text-muted">+{models.length - 3} more</span>
              )}
            </div>
          </div>
        </div>

        {/* Actions: Round-robin toggle + Add Model */}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3 sm:shrink-0">
          <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer select-none">
            <Toggle
              checked={roundRobin}
              onChange={(v) => patch({ roundRobin: v })}
              disabled={!enabled}
              aria-label={`Round-robin ${cap.label} adapter`}
            />
            <span>Round</span>
          </label>
          <Button
            icon="add"
            variant="ghost"
            size="sm"
            onClick={() => setShowModelSelect(true)}
            disabled={!enabled}
            title={`Add ${cap.label} model`}
          >
            Add Model
          </Button>
        </div>
      </div>

      {showModelSelect && (
        <ModelSelectModal
          isOpen={showModelSelect}
          onClose={() => setShowModelSelect(false)}
          onSelect={handleAdd}
          activeProviders={activeProviders}
          title={`Add ${cap.label} Model`}
          addedModelValues={models}
          capFilter={cap.key}
          closeOnSelect={false}
        />
      )}
    </Card>
  );
}

function getComboModelDisplay(model, mappings, activeProviders) {
  const exactMatches = mappings.filter((item) =>
    item.routeModel === model || `${item.provider}/${item.upstreamModel}` === model
  );
  const matches = exactMatches.length
    ? exactMatches
    : mappings.filter((item) => item.mappedModel === model);

  if (matches.length) {
    return {
      providerName: [...new Set(matches.map((item) => item.providerName).filter(Boolean))].join(" + "),
      modelName: matches[0].mappedModel || matches[0].upstreamModel,
    };
  }

  const separator = model.indexOf("/");
  if (separator < 0) return { providerName: "Mapped model", modelName: model };
  const prefix = model.slice(0, separator);
  const upstreamModel = model.slice(separator + 1);
  const providerId = resolveProviderId(prefix);
  const connection = activeProviders.find((item) =>
    item.provider === providerId || item.providerSpecificData?.prefix === prefix
  );
  return {
    providerName: connection?.providerName || AI_PROVIDERS[providerId]?.name || prefix,
    modelName: upstreamModel,
  };
}

function ModelItem({ id, index, model, providerName, modelName, isFirst, isLast, onEdit, onMoveUp, onMoveDown, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    // no transition — prevents the CSS settle animation fighting React's re-render on drop
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 999 : undefined,
  };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(model);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== model) onEdit(trimmed);
    else setDraft(model);
    setEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") { setDraft(model); setEditing(false); }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 bg-black/[0.02] hover:bg-black/[0.04] dark:bg-white/[0.02] dark:hover:bg-white/[0.04] transition-colors ${isDragging ? "shadow-md ring-1 ring-primary/30" : ""}`}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        type="button"
        className="cursor-grab touch-none p-0.5 rounded text-text-muted hover:text-primary active:cursor-grabbing shrink-0"
        title="Drag to reorder"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="4" r="2"/><circle cx="15" cy="4" r="2"/>
          <circle cx="9" cy="12" r="2"/><circle cx="15" cy="12" r="2"/>
          <circle cx="9" cy="20" r="2"/><circle cx="15" cy="20" r="2"/>
        </svg>
      </button>

      {/* Index badge */}
      <span className="text-[10px] font-medium text-text-muted w-3 text-center shrink-0">{index + 1}</span>

      {/* Inline editable model value */}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 rounded border border-primary/40 bg-white px-1.5 py-0.5 font-mono text-xs text-text-main outline-none dark:bg-black/20"
        />
      ) : (
        <div
          className="flex min-w-0 flex-1 cursor-text items-baseline gap-1.5 rounded px-1.5 py-0.5 hover:bg-black/5 dark:hover:bg-white/5"
          onClick={() => setEditing(true)}
          title={`${providerName} / ${modelName}\nRoute: ${model}\nClick to edit route value`}
        >
          <span className="shrink-0 truncate text-[11px] font-medium text-text-muted">{providerName}</span>
          <span className="shrink-0 text-[10px] text-text-muted/60">/</span>
          <span className="min-w-0 truncate font-mono text-xs text-text-main">{modelName}</span>
        </div>
      )}

      {/* Priority arrows */}
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          className={`p-0.5 rounded ${isFirst ? "text-text-muted/20 cursor-not-allowed" : "text-text-muted hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"}`}
          title="Move up"
        >
          <span className="material-symbols-outlined text-[12px]">arrow_upward</span>
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          className={`p-0.5 rounded ${isLast ? "text-text-muted/20 cursor-not-allowed" : "text-text-muted hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"}`}
          title="Move down"
        >
          <span className="material-symbols-outlined text-[12px]">arrow_downward</span>
        </button>
      </div>

      {/* Remove */}
      <button
        onClick={onRemove}
        className="p-0.5 hover:bg-red-500/10 rounded text-text-muted hover:text-red-500 transition-all"
        title="Remove"
      >
        <span className="material-symbols-outlined text-[12px]">close</span>
      </button>
    </div>
  );
}

function ComboFormModal({ isOpen, combo, onClose, onSave, activeProviders, kindFilter = null }) {
  // Initialize state with combo values - key prop on parent handles reset on remount
  const [name, setName] = useState(combo?.name || "");
  const [description, setDescription] = useState(combo?.description || "");
  const [models, setModels] = useState(combo?.models || []);
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [modelAliases, setModelAliases] = useState({});
  const [modelMappings, setModelMappings] = useState([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Use stable index-based IDs so duplicates and similar names are handled correctly
  const modelItems = models.map((model, i) => ({
    uid: `item-${i}`,
    model,
    ...getComboModelDisplay(model, modelMappings, activeProviders),
  }));

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = modelItems.findIndex((m) => m.uid === active.id);
      const newIndex = modelItems.findIndex((m) => m.uid === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        setModels((prev) => arrayMove(prev, oldIndex, newIndex));
      }
    }
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;

    Promise.all([
      fetch("/api/models/alias"),
      fetch("/api/model-mappings"),
    ]).then(async ([aliasesRes, mappingsRes]) => {
      const [aliasesData, mappingsData] = await Promise.all([
        aliasesRes.ok ? aliasesRes.json() : null,
        mappingsRes.ok ? mappingsRes.json() : null,
      ]);
      if (cancelled) return;
      if (aliasesData) setModelAliases(aliasesData.aliases || {});
      if (mappingsData) setModelMappings(mappingsData.mappings || []);
    }).catch((error) => {
      if (!cancelled) console.error("Error fetching modal data:", error);
    });

    return () => { cancelled = true; };
  }, [isOpen]);

  const validateName = (value) => {
    if (!value.trim()) {
      setNameError("Name is required");
      return false;
    }
    if (!VALID_NAME_REGEX.test(value)) {
      setNameError("Only letters, numbers, -, _ and . allowed");
      return false;
    }
    setNameError("");
    return true;
  };

  const handleNameChange = (e) => {
    const value = e.target.value;
    setName(value);
    if (value) validateName(value);
    else setNameError("");
  };

  const handleAddModel = (model) => {
    if (!models.includes(model.value)) {
      setModels([...models, model.value]);
    }
  };

  const handleDeselectModel = (model) => {
    setModels(models.filter((m) => m !== model.value));
  };

  const handleRemoveModel = (index) => {
    setModels(models.filter((_, i) => i !== index));
  };

  const handleMoveUp = (index) => {
    if (index === 0) return;
    const newModels = [...models];
    [newModels[index - 1], newModels[index]] = [newModels[index], newModels[index - 1]];
    setModels(newModels);
  };

  const handleMoveDown = (index) => {
    if (index === models.length - 1) return;
    const newModels = [...models];
    [newModels[index], newModels[index + 1]] = [newModels[index + 1], newModels[index]];
    setModels(newModels);
  };

  const handleSave = async () => {
    if (!validateName(name)) return;
    setSaving(true);
    await onSave({ name: name.trim(), description: description.trim(), models });
    setSaving(false);
  };

  const isEdit = !!combo;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={isEdit ? "编辑模型组合" : "新建模型组合"}
      >
        <div className="flex flex-col gap-3">
          {/* Name */}
          <div>
            <Input
              label="模型组合名称"
              value={name}
              onChange={handleNameChange}
              placeholder="my-combo"
              error={nameError}
            />
            <p className="text-[10px] text-text-muted mt-0.5">
              Only letters, numbers, -, _ and . allowed
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="combo-description">备注</label>
            <textarea
              id="combo-description"
              rows={3}
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="说明模型组合的用途、能力或适用场景"
              className="w-full resize-y rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
            <p className="mt-0.5 text-right text-[10px] text-text-muted">{description.length}/500</p>
          </div>

          {/* Models */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">模型</label>

            {models.length === 0 ? (
              <div className="text-center py-4 border border-dashed border-black/10 dark:border-white/10 rounded-lg bg-black/[0.01] dark:bg-white/[0.01]">
                <span className="material-symbols-outlined text-text-muted text-xl mb-1">layers</span>
                <p className="text-xs text-text-muted">尚未添加模型</p>
              </div>
            ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
              <SortableContext items={modelItems.map((m) => m.uid)} strategy={verticalListSortingStrategy}>
                <div className="flex max-h-[55vh] min-w-0 flex-col gap-1 overflow-y-auto sm:max-h-[350px]">
                  {modelItems.map(({ uid, model, providerName, modelName }, index) => (
                    <ModelItem
                      key={uid}
                      id={uid}
                      index={index}
                      model={model}
                      providerName={providerName}
                      modelName={modelName}
                      isFirst={index === 0}
                      isLast={index === modelItems.length - 1}
                      onEdit={(newVal) => {
                        const updated = [...models];
                        updated[index] = newVal;
                        setModels(updated);
                      }}
                      onMoveUp={() => handleMoveUp(index)}
                      onMoveDown={() => handleMoveDown(index)}
                      onRemove={() => handleRemoveModel(index)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            )}

            {/* Add Model button */}
            <button
              onClick={() => setShowModelSelect(true)}
              className="w-full mt-2 py-2 border border-dashed border-black/10 dark:border-white/10 rounded-lg text-xs text-primary font-medium hover:text-primary hover:border-primary/50 transition-colors flex items-center justify-center gap-1"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              增加模型
            </button>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <Button onClick={onClose} variant="ghost" fullWidth size="sm">
              取消
            </Button>
            <Button
              onClick={handleSave}
              fullWidth
              size="sm"
              disabled={!name.trim() || !!nameError || saving}
            >
              {saving ? "保存中..." : isEdit ? "保存" : "创建"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Model Select Modal */}
      {showModelSelect && (
        <ModelSelectModal
          isOpen={showModelSelect}
          onClose={() => setShowModelSelect(false)}
          onSelect={handleAddModel}
          onDeselect={handleDeselectModel}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title="向模型组合增加模型"
          kindFilter={kindFilter}
          addedModelValues={models}
          closeOnSelect={false}
        />
      )}
    </>
  );
}
