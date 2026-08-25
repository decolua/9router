"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Badge, Button, Card, CardSkeleton, Modal, Toggle } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { getProviderByAlias } from "@/shared/constants/providers";
import { translate } from "@/i18n/runtime";
import { useHeaderSearchStore } from "@/store/headerSearchStore";
import { useNotificationStore } from "@/store/notificationStore";

const TEST_CONCURRENCY = 4;

function getModelParts(model) {
  const providerAlias = model.owned_by || String(model.id).split("/")[0];
  const modelId = providerAlias === "combo"
    ? model.id
    : String(model.id).startsWith(`${providerAlias}/`)
      ? String(model.id).slice(providerAlias.length + 1)
      : model.id;
  const provider = providerAlias === "combo" ? null : getProviderByAlias(providerAlias);
  return {
    providerAlias,
    modelId,
    providerId: provider?.id || providerAlias,
    providerName: providerAlias === "combo" ? "Combo" : provider?.name || providerAlias,
  };
}

function TestStatus({ result, onViewDetails }) {
  if (!result) {
    return <span className="text-xs text-text-muted">Not tested</span>;
  }
  if (result.testing) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
        <span className="material-symbols-outlined animate-spin text-[15px]">progress_activity</span>
        Testing
      </span>
    );
  }
  if (result.ok) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <span className="material-symbols-outlined text-[15px]">check_circle</span>
        Working · {result.latencyMs} ms
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onViewDetails}
      className="inline-flex items-center gap-1.5 text-left text-xs font-medium text-red-600 transition-colors hover:text-red-700 hover:underline dark:text-red-400 dark:hover:text-red-300"
    >
      <span className="material-symbols-outlined shrink-0 text-[15px]">error</span>
      <span>{translate("Failed")} - {translate("View more details")}</span>
    </button>
  );
}

export default function ModelsPage() {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [visibilityFilter, setVisibilityFilter] = useState("all");
  const [testResults, setTestResults] = useState({});
  const [testingAll, setTestingAll] = useState(false);
  const [testProgress, setTestProgress] = useState({ completed: 0, total: 0 });
  const [updatingModels, setUpdatingModels] = useState(() => new Set());
  const [failureDetails, setFailureDetails] = useState(null);
  const searchQuery = useHeaderSearchStore((state) => state.query);
  const registerSearch = useHeaderSearchStore((state) => state.register);
  const unregisterSearch = useHeaderSearchStore((state) => state.unregister);
  const notify = useNotificationStore();

  const loadModels = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/models/catalog", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to load models");
      setModels(Array.isArray(data.data) ? data.data : []);
    } catch (error) {
      setLoadError(error.message || "Failed to load models");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    registerSearch("Search models or providers...");
    return () => unregisterSearch();
  }, [registerSearch, unregisterSearch]);

  useEffect(() => {
    const timer = globalThis.setTimeout(loadModels, 0);
    return () => globalThis.clearTimeout(timer);
  }, [loadModels]);

  const enrichedModels = useMemo(
    () => models.map((model) => ({ ...model, ...getModelParts(model) })),
    [models],
  );

  const providers = useMemo(() => {
    const unique = new Map();
    for (const model of enrichedModels) {
      unique.set(model.providerAlias, model.providerName);
    }
    return Array.from(unique, ([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [enrichedModels]);

  const filteredModels = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return enrichedModels.filter((model) => {
      if (providerFilter !== "all" && model.providerAlias !== providerFilter) return false;
      if (visibilityFilter === "visible" && model.disabled) return false;
      if (visibilityFilter === "hidden" && !model.disabled) return false;
      if (visibilityFilter === "working" && testResults[model.id]?.ok !== true) return false;
      if (visibilityFilter === "failed" && testResults[model.id]?.ok !== false) return false;
      if (!query) return true;
      return model.id.toLowerCase().includes(query)
        || model.providerName.toLowerCase().includes(query)
        || model.providerAlias.toLowerCase().includes(query);
    });
  }, [enrichedModels, providerFilter, searchQuery, testResults, visibilityFilter]);

  const stats = useMemo(() => {
    const hidden = enrichedModels.filter((model) => model.disabled).length;
    const tested = Object.values(testResults).filter((result) => !result.testing).length;
    const working = Object.values(testResults).filter((result) => result.ok === true).length;
    return {
      total: enrichedModels.length,
      visible: enrichedModels.length - hidden,
      hidden,
      tested,
      working,
    };
  }, [enrichedModels, testResults]);

  const setModelVisibility = useCallback(async (model, shouldBeVisible, showNotification = false) => {
    if (model.disabled === !shouldBeVisible) return true;

    setUpdatingModels((current) => new Set(current).add(model.id));
    try {
      const response = shouldBeVisible
        ? await fetch(
            `/api/models/disabled?providerAlias=${encodeURIComponent(model.providerAlias)}&id=${encodeURIComponent(model.modelId)}`,
            { method: "DELETE" },
          )
        : await fetch("/api/models/disabled", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              providerAlias: model.providerAlias,
              ids: [model.modelId],
            }),
          });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to update model visibility");
      setModels((current) => current.map((item) => (
        item.id === model.id ? { ...item, disabled: !shouldBeVisible } : item
      )));
      if (showNotification) {
        notify.success(
          shouldBeVisible
            ? translate("Model is visible in /v1/models")
            : translate("Model is hidden from /v1/models"),
        );
      }
      return true;
    } catch (error) {
      if (showNotification) {
        notify.error(error.message || translate("Failed to update model visibility"));
      }
      return false;
    } finally {
      setUpdatingModels((current) => {
        const next = new Set(current);
        next.delete(model.id);
        return next;
      });
    }
  }, [notify]);

  const testModel = useCallback(async (model) => {
    setTestResults((current) => ({
      ...current,
      [model.id]: { testing: true },
    }));
    try {
      const response = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: model.id, kind: "llm" }),
      });
      const result = await response.json().catch(() => ({}));
      const normalized = response.ok
        ? result
        : {
            ...result,
            ok: false,
            error: result.error || `HTTP ${response.status}`,
            requestStatus: response.status,
          };
      await setModelVisibility(model, normalized.ok === true);
      setTestResults((current) => ({ ...current, [model.id]: normalized }));
      return normalized;
    } catch (error) {
      const result = { ok: false, error: error.message || "Model test failed" };
      await setModelVisibility(model, false);
      setTestResults((current) => ({ ...current, [model.id]: result }));
      return result;
    }
  }, [setModelVisibility]);

  const handleTestAll = async () => {
    if (testingAll) return;
    const queue = enrichedModels;
    if (queue.length === 0) {
      notify.info(translate("No visible models to test"));
      return;
    }

    setTestingAll(true);
    setTestProgress({ completed: 0, total: queue.length });
    let nextIndex = 0;
    let completed = 0;
    let working = 0;

    const worker = async () => {
      while (nextIndex < queue.length) {
        const model = queue[nextIndex];
        nextIndex += 1;
        const result = await testModel(model);
        if (result.ok) working += 1;
        completed += 1;
        setTestProgress({ completed, total: queue.length });
      }
    };

    try {
      await Promise.all(
        Array.from({ length: Math.min(TEST_CONCURRENCY, queue.length) }, () => worker()),
      );
      notify.success(
        `${translate("Model tests completed")}: ${working}/${queue.length} ${translate("working")}`,
      );
    } finally {
      setTestingAll(false);
    }
  };

  const handleVisibilityChange = (model, shouldBeVisible) => {
    setModelVisibility(model, shouldBeVisible, true);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-5 px-1 sm:px-0">
      <Card className="overflow-hidden bg-gradient-to-br from-surface via-surface to-primary/5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs text-text-muted">Live catalog</span>
            </div>
            <h2 className="text-xl font-semibold text-text-main">Model catalog and health checks</h2>
            <p className="mt-1 text-sm leading-6 text-text-muted">
              Test model responses and choose which models are published by the OpenAI-compatible endpoint.
            </p>
          </div>
          <Button
            icon={testingAll ? "progress_activity" : "play_arrow"}
            onClick={handleTestAll}
            disabled={testingAll || stats.total === 0}
            loading={testingAll}
            className="w-full lg:w-auto"
          >
            {testingAll
              ? <>{translate("Testing models")} {testProgress.completed}/{testProgress.total}</>
              : "Test all models"}
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon="deployed_code" label="Total models" value={stats.total} tone="primary" />
        <StatCard icon="visibility" label="Visible in /v1/models" value={stats.visible} tone="success" />
        <StatCard icon="visibility_off" label="Manually hidden" value={stats.hidden} tone="muted" />
        <StatCard
          icon="monitor_heart"
          label="Working after test"
          value={stats.tested ? `${stats.working}/${stats.tested}` : "—"}
          tone="warning"
        />
      </div>

      <Card padding="sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="flex items-center gap-2 text-xs text-text-muted">
              <span>Provider</span>
              <select
                value={providerFilter}
                onChange={(event) => setProviderFilter(event.target.value)}
                className="min-w-44 rounded-lg border border-border-subtle bg-bg px-3 py-2 text-sm text-text-main outline-none focus:border-primary/60"
              >
                <option value="all">All providers</option>
                {providers.map((provider) => (
                  <option key={provider.value} value={provider.value}>{provider.label}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-text-muted">
              <span>Status</span>
              <select
                value={visibilityFilter}
                onChange={(event) => setVisibilityFilter(event.target.value)}
                className="min-w-40 rounded-lg border border-border-subtle bg-bg px-3 py-2 text-sm text-text-main outline-none focus:border-primary/60"
              >
                <option value="all">All models</option>
                <option value="visible">Visible</option>
                <option value="hidden">Hidden</option>
                <option value="working">Working</option>
                <option value="failed">Failed</option>
              </select>
            </label>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-text-muted md:justify-end">
            <span>{filteredModels.length} {translate("models shown")}</span>
            <Button variant="ghost" size="sm" icon="refresh" onClick={loadModels}>
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      {loadError ? (
        <Card className="border-red-500/30 bg-red-500/5 text-center">
          <span className="material-symbols-outlined mb-2 text-3xl text-red-500">cloud_off</span>
          <p className="font-medium text-text-main">Failed to load model catalog</p>
          <p className="mt-1 text-sm text-text-muted">{loadError}</p>
          <Button className="mt-4" size="sm" onClick={loadModels}>Try again</Button>
        </Card>
      ) : filteredModels.length === 0 ? (
        <Card className="py-12 text-center">
          <span className="material-symbols-outlined mb-2 text-3xl text-text-muted">search_off</span>
          <p className="font-medium text-text-main">No models match the current filters</p>
          <p className="mt-1 text-sm text-text-muted">Change the provider, status, or search query.</p>
        </Card>
      ) : (
        <Card padding="none" className="overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(140px,.65fr)_minmax(190px,.8fr)_150px_110px] gap-4 border-b border-border-subtle bg-surface-2/60 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted lg:grid">
            <span>Model</span>
            <span>Provider</span>
            <span>Health</span>
            <span>Published</span>
            <span className="text-right">Action</span>
          </div>
          <div className="divide-y divide-border-subtle">
            {filteredModels.map((model) => {
              const result = testResults[model.id];
              const updating = updatingModels.has(model.id);
              return (
                <div
                  key={model.id}
                  className={`grid gap-4 px-4 py-4 transition-colors lg:grid-cols-[minmax(0,1.5fr)_minmax(140px,.65fr)_minmax(190px,.8fr)_150px_110px] lg:items-center lg:px-5 ${model.disabled ? "bg-surface-2/35" : "hover:bg-surface-2/25"}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="truncate text-sm font-semibold text-text-main" title={model.id}>{model.id}</code>
                      {model.disabled && <Badge variant="default" size="sm">Hidden</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-text-muted">Chat completion model</p>
                  </div>
                  <div className="flex min-w-0 items-center gap-2.5">
                    {model.providerAlias === "combo" ? (
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <span className="material-symbols-outlined text-[18px]">merge_type</span>
                      </span>
                    ) : (
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2">
                        <ProviderIcon
                          providerId={model.providerId}
                          alt={model.providerName}
                          size={24}
                          fallbackText={model.providerName.slice(0, 2).toUpperCase()}
                        />
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text-main">{model.providerName}</p>
                      <p className="truncate text-[11px] text-text-muted">{model.providerAlias}</p>
                    </div>
                  </div>
                  <div>
                    <TestStatus
                      result={result}
                      onViewDetails={() => setFailureDetails({ model, result })}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 lg:justify-start">
                    <span className="text-xs text-text-muted lg:hidden">Visible in /v1/models</span>
                    <Toggle
                      checked={!model.disabled}
                      onChange={(checked) => handleVisibilityChange(model, checked)}
                      disabled={updating}
                      size="sm"
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={result?.testing ? "progress_activity" : "play_arrow"}
                      loading={result?.testing}
                      disabled={result?.testing || testingAll}
                      onClick={() => testModel(model)}
                    >
                      Test
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Modal
        isOpen={!!failureDetails}
        onClose={() => setFailureDetails(null)}
        title={`${translate("Model")} · ${translate("Details")}`}
        size="lg"
        footer={
          <Button variant="secondary" onClick={() => setFailureDetails(null)}>
            {translate("Close")}
          </Button>
        }
      >
        {failureDetails && (
          <div className="space-y-4">
            <div className="rounded-xl border border-red-500/25 bg-red-500/5 p-4">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined mt-0.5 text-red-500">error</span>
                <div className="min-w-0">
                  <p className="font-semibold text-red-600 dark:text-red-400">
                    {failureDetails.result.error || translate("Model test failed")}
                  </p>
                  <p className="mt-1 break-all font-mono text-xs text-text-muted">
                    {failureDetails.model.id}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <DetailItem label={translate("Provider")} value={failureDetails.model.providerName} />
              <DetailItem
                label={translate("Status")}
                value={failureDetails.result.status ?? failureDetails.result.requestStatus ?? "—"}
              />
              <DetailItem
                label="ms"
                value={Number.isFinite(failureDetails.result.latencyMs)
                  ? failureDetails.result.latencyMs
                  : "—"}
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                {translate("Details")}
              </p>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border-subtle bg-bg p-4 text-xs text-text-main custom-scrollbar">
                {JSON.stringify(failureDetails.result, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function DetailItem({ label, value }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-text-main" title={String(value)}>{value}</p>
    </div>
  );
}

function StatCard({ icon, label, value, tone }) {
  const tones = {
    primary: "bg-primary/10 text-primary",
    success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    muted: "bg-surface-3 text-text-muted",
  };
  return (
    <Card padding="sm">
      <div className="flex items-center gap-3">
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>
          <span className="material-symbols-outlined text-[19px]">{icon}</span>
        </span>
        <div className="min-w-0">
          <p className="text-xl font-semibold tabular-nums text-text-main">{value}</p>
          <p className="truncate text-xs text-text-muted">{label}</p>
        </div>
      </div>
    </Card>
  );
}

TestStatus.propTypes = {
  result: PropTypes.shape({
    testing: PropTypes.bool,
    ok: PropTypes.bool,
    latencyMs: PropTypes.number,
    error: PropTypes.string,
  }),
  onViewDetails: PropTypes.func,
};

DetailItem.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
};

StatCard.propTypes = {
  icon: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  tone: PropTypes.oneOf(["primary", "success", "warning", "muted"]).isRequired,
};
