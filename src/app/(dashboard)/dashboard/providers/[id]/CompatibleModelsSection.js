"use client";

import { useRef, useState } from "react";
import PropTypes from "prop-types";
import { Button } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { runModelBatchTest } from "@/shared/utils/modelBatchTester";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";

function CompatibleModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias, onTest, testStatus, isTesting, latencyMs, error }) {
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

  const statusTitle = error
    ? `Error: ${error}`
    : latencyMs != null
    ? `${latencyMs}ms`
    : undefined;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${borderColor} hover:bg-sidebar/50`} title={statusTitle}>
      <span
        className="material-symbols-outlined text-base text-text-muted"
        style={iconColor ? { color: iconColor } : undefined}
      >
        {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{modelId}</p>
        <div className="flex items-center gap-1 mt-1">
          <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
          {latencyMs != null && (
            <span className="text-[10px] tabular-nums text-text-muted/70">{latencyMs}ms</span>
          )}
          <div className="relative group/btn">
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
            <div className="relative group/btn">
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
        {error && (
          <p className="text-[10px] text-red-500 mt-1 truncate" title={error}>{error}</p>
        )}
      </div>
      <button
        onClick={onDeleteAlias}
        className="p-1 hover:bg-red-50 rounded text-red-500"
        title="Remove model"
      >
        <span className="material-symbols-outlined text-sm">delete</span>
      </button>
    </div>
  );
}

export default function CompatibleModelsSection({ providerStorageAlias, providerDisplayAlias, modelAliases, customModels, copied, onCopy, onDeleteAlias, onAddCustomModel, onDeleteCustomModel, connections, isAnthropic }) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [testingModelId, setTestingModelId] = useState(null);
  const [modelTestResults, setModelTestResults] = useState({});
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [batchTesting, setBatchTesting] = useState(false);
  const [batchStopping, setBatchStopping] = useState(false);
  const [batchResults, setBatchResults] = useState({});
  const [batchSummary, setBatchSummary] = useState(null);
  const stopBatchTestRef = useRef(false);
  const notify = useNotificationStore();

  const allModels = getProviderCustomModelRows({
    customModels,
    modelAliases,
    providerAlias: providerStorageAlias,
    type: "llm",
  });

  const modelSearch = modelSearchQuery.trim().toLowerCase();
  const filteredModels = allModels.filter((model) =>
    !modelSearch ||
    (model.id || "").toLowerCase().includes(modelSearch) ||
    (model.name || "").toLowerCase().includes(modelSearch) ||
    (model.fullModel || "").toLowerCase().includes(modelSearch)
  );
  const shownCount = filteredModels.length;
  const canTest = connections.length > 0;
  const batchRunning = batchTesting || batchStopping;

  const handleTestModel = async (modelId) => {
    if (testingModelId) return;
    setTestingModelId(modelId);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
    } finally {
      setTestingModelId(null);
    }
  };

  // Batch-test every model currently shown (respects the search filter),
  // with the shared bounded-concurrency pool. Per-model state lands in
  // batchResults; rows render it through the same testStatus/isTesting props.
  const handleTestModels = async () => {
    if (shownCount === 0 || batchTesting) return;

    const initial = {};
    filteredModels.forEach((m) => {
      initial[m.id] = { state: "queued", latencyMs: null, error: null };
    });

    stopBatchTestRef.current = false;
    setBatchTesting(true);
    setBatchStopping(false);
    setBatchResults(initial);
    setBatchSummary(null);

    try {
      const finalSummary = await runModelBatchTest({
        models: filteredModels.map((m) => ({ id: m.id, fullModel: `${providerStorageAlias}/${m.id}` })),
        buildFullModel: (m) => m.fullModel,
        onResult: (modelId, result) =>
          setBatchResults((prev) => ({ ...prev, [modelId]: result })),
        onSummary: setBatchSummary,
        stopRef: stopBatchTestRef,
      });

      if (finalSummary.stopped) {
        notify.warning(`Stopped: ${finalSummary.passed}/${finalSummary.completed} passed`);
      } else if (finalSummary.failed === 0) {
        notify.success(`All ${finalSummary.total} models passed`);
      } else {
        notify.warning(`${finalSummary.passed}/${finalSummary.total} passed, ${finalSummary.failed} failed`);
      }
    } catch (error) {
      notify.error("Model batch test failed");
      console.log("Error in batch model test:", error);
    } finally {
      setBatchTesting(false);
      setBatchStopping(false);
      stopBatchTestRef.current = false;
    }
  };

  const handleStopTestModels = () => {
    if (!batchTesting) return;
    stopBatchTestRef.current = true;
    setBatchStopping(true);
  };

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();
    if (allModels.some((model) => model.id === modelId)) {
      alert("Model already exists for this provider.");
      return;
    }

    setAdding(true);
    try {
      await onAddCustomModel(modelId);
      setNewModel("");
    } catch (error) {
      console.log("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  const handleImport = async () => {
    if (importing) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) return;

    setImporting(true);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models`);
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to import models");
        return;
      }
      const models = data.models || [];
      if (models.length === 0) {
        alert("No models returned from /models.");
        return;
      }
      let importedCount = 0;
      for (const model of models) {
        const modelId = model.id || model.name || model.model;
        if (!modelId) continue;
        if (allModels.some((entry) => entry.id === modelId)) continue;
        await onAddCustomModel(modelId);
        importedCount += 1;
      }
      if (importedCount === 0) {
        alert("No new models were added.");
      }
    } catch (error) {
      console.log("Error importing models:", error);
    } finally {
      setImporting(false);
    }
  };

  const canImport = connections.some((conn) => conn.isActive !== false);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        Add {isAnthropic ? "Anthropic" : "OpenAI"}-compatible models manually or import them from the /models endpoint.
      </p>

      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <label htmlFor="new-compatible-model-input" className="text-xs text-text-muted mb-1 block">Model ID</label>
          <input
            id="new-compatible-model-input"
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder={isAnthropic ? "claude-3-opus-20240229" : "gpt-4o"}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
          />
        </div>
        <Button size="sm" icon="add" onClick={handleAdd} disabled={!newModel.trim() || adding}>
          {adding ? "Adding..." : "Add"}
        </Button>
        <Button size="sm" variant="secondary" icon="download" onClick={handleImport} disabled={!canImport || importing}>
          {importing ? "Importing..." : "Import from /models"}
        </Button>
      </div>

      {!canImport && (
        <p className="text-xs text-text-muted">
          Add a connection to enable importing models.
        </p>
      )}

      {allModels.length > 0 && (
        <>
          <div className="flex flex-col gap-2 border-t border-black/[0.03] pt-3 dark:border-white/[0.03] lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-xs">
              <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[16px] pointer-events-none">
                search
              </span>
              <input
                type="text"
                value={modelSearchQuery}
                onChange={(e) => setModelSearchQuery(e.target.value)}
                placeholder="Search models..."
                className="w-full h-9 pl-8 pr-7 rounded-lg border border-border bg-surface-2 text-sm focus:outline-none focus:border-primary/50 transition-colors"
              />
              {modelSearchQuery && (
                <button
                  type="button"
                  onClick={() => setModelSearchQuery("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main p-0.5 rounded"
                  aria-label="Clear model search"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {batchSummary && (
                <span className="text-xs text-text-muted tabular-nums">
                  {batchSummary.completed}/{batchSummary.total} · {batchSummary.passed} ok{batchSummary.failed > 0 ? ` · ${batchSummary.failed} fail` : ""}{batchSummary.avgLatencyMs != null ? ` · avg ${batchSummary.avgLatencyMs}ms` : ""}{batchSummary.stopped ? " · stopped" : ""}
                </span>
              )}
              {batchRunning ? (
                <Button size="sm" variant="ghost" icon="stop" onClick={handleStopTestModels} disabled={batchStopping}>
                  {batchStopping ? "Stopping..." : "Stop"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  icon="science"
                  onClick={handleTestModels}
                  disabled={!canTest || shownCount === 0}
                  title={canTest ? `Test the ${shownCount} model(s) shown` : "Add a connection to test models"}
                >
                  Test {shownCount} Model{shownCount === 1 ? "" : "s"}
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {filteredModels.map(({ id, alias, source }) => (
              <CompatibleModelRow
                key={`${source}-${providerStorageAlias}/${id}`}
                modelId={id}
                fullModel={`${providerDisplayAlias}/${id}`}
                copied={copied}
                onCopy={onCopy}
                onDeleteAlias={() => source === "custom" ? onDeleteCustomModel(id) : onDeleteAlias(alias)}
                onTest={canTest ? () => handleTestModel(id) : undefined}
                testStatus={batchResults[id]?.state === "ok" ? "ok" : batchResults[id]?.state === "error" ? "error" : modelTestResults[id]}
                isTesting={testingModelId === id || batchResults[id]?.state === "testing"}
                latencyMs={batchResults[id]?.latencyMs ?? null}
                error={batchResults[id]?.error ?? null}
              />
            ))}
            {modelSearch && shownCount === 0 && (
              <div className="flex w-full flex-col items-center gap-1 py-6 text-center">
                <span className="material-symbols-outlined text-[28px] text-text-muted">
                  search_off
                </span>
                <p className="text-sm text-text-muted">No models match &quot;{modelSearchQuery}&quot;</p>
              </div>
            )}
          </div>
        </>
      )}
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
  onAddCustomModel: PropTypes.func.isRequired,
  onDeleteCustomModel: PropTypes.func.isRequired,
  connections: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    isActive: PropTypes.bool,
  })).isRequired,
  isAnthropic: PropTypes.bool,
};
