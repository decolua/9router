"use client";

import { useState } from "react";
import { Modal, Button } from "@/shared/components";

const DIFF_COLORS = {
  new: "text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/30",
  removed: "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/30",
  changed: "text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  unchanged: "text-gray-500 dark:text-gray-400 bg-gray-500/10 border-gray-500/20",
};

const KIND_COLORS = {
  embedding: "text-purple-600 dark:text-purple-400 bg-purple-500/10 border-purple-500/30",
  image: "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/30",
  tts: "text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/30",
  stt: "text-teal-600 dark:text-teal-400 bg-teal-500/10 border-teal-500/30",
  unknown: "text-gray-500 dark:text-gray-400 bg-gray-500/10 border-gray-500/20",
};

function DiffBadge({ diff }) {
  const cls = DIFF_COLORS[diff] || DIFF_COLORS.unchanged;
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {diff}
    </span>
  );
}

function KindBadge({ kind }) {
  if (!kind || kind === "llm") return null;
  const cls = KIND_COLORS[kind] || KIND_COLORS.unknown;
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {kind}
    </span>
  );
}

export default function SyncUpstreamModelsModal({ isOpen, onClose, connectionId, providerAlias, onSuccess }) {
  const [phase, setPhase] = useState("initial");
  const [discoverData, setDiscoverData] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState("");
  const [importResult, setImportResult] = useState(null);

  const handleClose = () => {
    setPhase("initial");
    setDiscoverData(null);
    setSelected(new Set());
    setError("");
    setImportResult(null);
    onClose();
  };

  const handleDiscover = async () => {
    setPhase("loading");
    setError("");
    try {
      const res = await fetch(`/api/providers/${connectionId}/models/discover`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Discover failed");
        setPhase("initial");
        return;
      }
      const models = data.models || [];
      // Default-select new + changed
      const defaultSelected = new Set(
        models.filter((m) => m.diff === "new" || m.diff === "changed").map((m) => m.canonicalId)
      );
      setDiscoverData(data);
      setSelected(defaultSelected);
      setPhase("preview");
    } catch (err) {
      setError(err.message || "Network error");
      setPhase("initial");
    }
  };

  const handleImport = async () => {
    if (selected.size === 0) return;
    setPhase("importing");
    setError("");
    try {
      const res = await fetch("/api/models/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshotId: discoverData?.snapshotId,
          selectedCanonicalIds: [...selected],
          dryRun: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Import failed");
        setPhase("preview");
        return;
      }
      setImportResult(data);
      setPhase("done");
      if (onSuccess) onSuccess();
      setTimeout(() => handleClose(), 3000);
    } catch (err) {
      setError(err.message || "Network error");
      setPhase("preview");
    }
  };

  const models = discoverData?.models || [];
  const byDiff = {
    new: models.filter((m) => m.diff === "new"),
    removed: models.filter((m) => m.diff === "removed"),
    changed: models.filter((m) => m.diff === "changed"),
    unchanged: models.filter((m) => m.diff === "unchanged"),
  };

  const allIds = models.map((m) => m.canonicalId);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  };

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const renderInitial = () => (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        发现上游提供的所有模型，与当前快照对比差异，然后选择要导入的模型。
      </p>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={handleClose}>取消</Button>
        <Button variant="secondary" icon="sync" onClick={handleDiscover}>开始同步</Button>
      </div>
    </div>
  );

  const renderLoading = () => (
    <div className="flex flex-col items-center gap-3 py-6">
      <span className="material-symbols-outlined animate-spin text-3xl text-primary">progress_activity</span>
      <p className="text-sm text-text-muted">正在发现上游模型...</p>
    </div>
  );

  const renderPreview = () => (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 text-xs text-text-muted">
        <span className="text-green-600 dark:text-green-400">新增 {byDiff.new.length}</span>
        <span className="text-red-600 dark:text-red-400">移除 {byDiff.removed.length}</span>
        <span className="text-yellow-600 dark:text-yellow-400">变更 {byDiff.changed.length}</span>
        <span>未变 {byDiff.unchanged.length}</span>
      </div>

      {discoverData?.warnings?.length > 0 && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2">
          {discoverData.warnings.map((w, i) => (
            <p key={i} className="text-xs text-yellow-600 dark:text-yellow-400">{w}</p>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 border-b border-black/[0.05] pb-2 dark:border-white/[0.05]">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleAll}
          className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
        />
        <span className="text-xs text-text-muted">全选 / 取消全选</span>
        <span className="ml-auto text-xs text-text-muted">已选 {selected.size} / {models.length}</span>
      </div>

      <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {models.map((m) => (
          <label
            key={m.canonicalId}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
          >
            <input
              type="checkbox"
              checked={selected.has(m.canonicalId)}
              onChange={() => toggleOne(m.canonicalId)}
              className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-text-main">{m.displayName || m.canonicalId}</p>
              <p className="truncate text-[10px] text-text-muted">{m.canonicalId}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {m.contextWindow && (
                <span className="text-[10px] text-text-muted">{(m.contextWindow / 1000).toFixed(0)}k</span>
              )}
              <KindBadge kind={m.modelKind} />
              <DiffBadge diff={m.diff} />
            </div>
          </label>
        ))}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={handleClose}>取消</Button>
        <Button
          icon="download"
          onClick={handleImport}
          disabled={selected.size === 0}
        >
          导入选中模型 ({selected.size})
        </Button>
      </div>
    </div>
  );

  const renderImporting = () => (
    <div className="flex flex-col items-center gap-3 py-6">
      <span className="material-symbols-outlined animate-spin text-3xl text-primary">progress_activity</span>
      <p className="text-sm text-text-muted">正在导入...</p>
    </div>
  );

  const renderDone = () => (
    <div className="flex flex-col items-center gap-3 py-6">
      <span className="material-symbols-outlined text-3xl text-green-500">check_circle</span>
      <p className="text-sm font-medium text-text-main">导入完成</p>
      {importResult && (
        <p className="text-xs text-text-muted">
          写入 {importResult.written ?? 0} 个，跳过 {importResult.skipped ?? 0} 个
        </p>
      )}
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="同步上游模型">
      {phase === "initial" && renderInitial()}
      {phase === "loading" && renderLoading()}
      {phase === "preview" && renderPreview()}
      {phase === "importing" && renderImporting()}
      {phase === "done" && renderDone()}
    </Modal>
  );
}
