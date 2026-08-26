"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button } from "@/shared/components";
import { ConfirmModal } from "@/shared/components/Modal";
import { useNotificationStore } from "@/store/notificationStore";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";
function CompatibleModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias, onTest, testStatus, testError, isTesting, description, onEditDescription }) {
  const borderColor = testStatus === "ok"
    ? "border-green-500/40"
    : testStatus === "error"
    ? "border-red-500/40"
    : "border-border";

  const iconColor = testStatus === "ok"
    ? "#22c55e"
    : testStatus === "error"
    ? "#ef4444"
    : undefined;

  return (
    <div className={`group flex min-h-24 min-w-0 items-center gap-3 rounded-md border p-3 ${borderColor} hover:bg-sidebar/50`}>
      <span
        className="material-symbols-outlined text-base text-text-muted"
        style={iconColor ? { color: iconColor } : undefined}
      >
        {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{modelId}</p>
        {description && <p className="mt-1 truncate text-xs text-text-muted" title={description}>{description}</p>}
        {testStatus === "error" && testError && <p className="mt-1 truncate text-xs text-red-500" title={testError}>{testError}</p>}
        <div className="flex items-center gap-1 mt-1">
          <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
          <div className="relative opacity-100 transition-opacity group/btn sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            <button
              onClick={() => onCopy(fullModel, `model-${modelId}`)}
              className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary"
            >
              <span className="material-symbols-outlined text-sm">
                {copied === `model-${modelId}` ? "check" : "content_copy"}
              </span>
            </button>
            <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {copied === `model-${modelId}` ? "Copied!" : "Copy"}
            </span>
          </div>
          {onTest && (
            <div className={`relative transition-opacity group/btn ${isTesting ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"}`}>
              <button
                onClick={onTest}
                disabled={isTesting}
                className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                  {isTesting ? "progress_activity" : "science"}
                </span>
              </button>
              <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
                {isTesting ? "Testing..." : "Test"}
              </span>
            </div>
          )}
        </div>
      </div>
      <button onClick={onEditDescription} className="rounded p-1 text-text-muted opacity-100 transition-opacity hover:bg-sidebar hover:text-primary sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" title="配置模型说明">
        <span className="material-symbols-outlined text-sm">edit_note</span>
      </button>
      <button
        onClick={onDeleteAlias}
        className="rounded p-1 text-red-500 opacity-100 transition-opacity hover:bg-red-50 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
        title="Remove model"
      >
        <span className="material-symbols-outlined text-sm">delete</span>
      </button>
    </div>
  );
}

export default function CompatibleModelsSection({ providerStorageAlias, providerDisplayAlias, modelAliases, customModels, copied, onCopy, onDeleteAlias, onDeleteCustomModel, connections, isAnthropic, onTestModel, modelTestResults, modelTestErrors = {}, testingModelIds, modelDescriptions, onEditModelDescription }) {
  const [importing, setImporting] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const notify = useNotificationStore();

  const allModels = getProviderCustomModelRows({
    customModels,
    modelAliases,
    providerAlias: providerStorageAlias,
    type: "llm",
  });

  const handleImport = async () => {
    if (importing) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) return;

    setImporting(true);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models`);
      const data = await res.json();
      if (!res.ok) {
        notify.error(data.error || "更新模型列表失败");
        return;
      }
      const models = data.models || [];
      if (models.length === 0) {
        notify.warning("提供商未返回模型");
        return;
      }
      const existingRows = allModels;
      await Promise.all(existingRows.map((entry) => (entry.source === "custom" ? onDeleteCustomModel(entry.id) : onDeleteAlias(entry.alias))));
      const normalizedModels = models.map((model) => model.id || model.name || model.model).filter(Boolean);
      await Promise.all(normalizedModels.map((modelId) => onAddCustomModel(modelId)));
      const importedCount = normalizedModels.length;
      if (importedCount === 0) {
        notify.info("没有新增模型");
      }
    } catch (error) {
      console.log("Error importing models:", error);
    } finally {
      setImporting(false);
    }
  };

  const canImport = connections.some((conn) => conn.isActive !== false);
  const handleDeleteAll = async () => {
    setDeleteAllOpen(false);
    await Promise.all(allModels.map((entry) => entry.source === "custom" ? onDeleteCustomModel(entry.id) : onDeleteAlias(entry.alias)));
    notify.success("已删除全部模型");
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        Add {isAnthropic ? "Anthropic" : "OpenAI"}-compatible models manually or import them from the configured models endpoint.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="md" variant="secondary" icon="download" onClick={handleImport} disabled={!canImport || importing}>
          {importing ? "正在更新..." : "更新模型列表"}
        </Button>
        {allModels.length > 0 && <Button size="md" variant="danger" icon="delete_sweep" onClick={() => setDeleteAllOpen(true)}>删除全部模型</Button>}
      </div>

      {!canImport && (
        <p className="text-xs text-text-muted">
          Add a connection to enable importing models.
        </p>
      )}

      {allModels.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {allModels.map(({ id, alias, source }) => (
            <CompatibleModelRow
              key={`${source}-${providerStorageAlias}/${id}`}
              modelId={id}
              fullModel={`${providerDisplayAlias}/${id}`}
              copied={copied}
              onCopy={onCopy}
              onDeleteAlias={() => source === "custom" ? onDeleteCustomModel(id) : onDeleteAlias(alias)}
              onTest={connections.length > 0 ? () => onTestModel(id) : undefined}
              testStatus={modelTestResults[id]}
              testError={modelTestErrors[id]}
              isTesting={testingModelIds.has(id)}
              description={modelDescriptions[id] || ""}
              onEditDescription={() => onEditModelDescription(id)}
            />
          ))}
        </div>
      )}
      <ConfirmModal isOpen={deleteAllOpen} onClose={() => setDeleteAllOpen(false)} onConfirm={handleDeleteAll} title="删除全部模型" message={`确认删除该提供商的 ${allModels.length} 个模型？`} confirmText="删除" cancelText="取消" variant="danger" />
    </div>
  );
}

CompatibleModelsSection.propTypes = {
  providerStorageAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  modelAliases: PropTypes.object.isRequired,
  customModels: PropTypes.arrayOf(PropTypes.object),
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  onDeleteCustomModel: PropTypes.func.isRequired,
  connections: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    isActive: PropTypes.bool,
  })).isRequired,
  isAnthropic: PropTypes.bool,
  onTestModel: PropTypes.func.isRequired,
  modelTestResults: PropTypes.object.isRequired,
  modelTestErrors: PropTypes.object,
  testingModelIds: PropTypes.instanceOf(Set).isRequired,
  modelDescriptions: PropTypes.object.isRequired,
  onEditModelDescription: PropTypes.func.isRequired,
};
