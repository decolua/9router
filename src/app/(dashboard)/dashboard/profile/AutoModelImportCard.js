"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, Button, Toggle, Select, ErrorReason } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { AI_PROVIDERS } from "@/shared/constants/providers";

export default function AutoModelImportCard() {
  const [loading, setLoading] = useState(true);
  const [autoImportSettings, setAutoImportSettings] = useState({
    enabled: false,
    hour: 4,
    lastRunAt: null,
    lastResult: null,
  });
  const [importRules, setImportRules] = useState({});
  const [saving, setSaving] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [error, setError] = useState("");
  // Custom (OpenAI-compatible) nodes are stored under generated ids; show
  // their names instead of "openai-compatible-chat-8bfc…".
  const [nodeNames, setNodeNames] = useState(null);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/models/import/auto");
      if (res.ok) {
        const data = await res.json();
        setAutoImportSettings(data.settings);
        setImportRules(data.rules || {});
      } else {
        setError("Failed to load auto-import settings");
      }
    } catch (err) {
      setError("An error occurred while loading settings");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Load settings on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSettings();
    fetch("/api/provider-nodes")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return; // unknown ≠ removed: keep null so nothing is flagged
        const names = {};
        for (const node of data?.nodes || []) if (node?.id && node?.name) names[node.id] = node.name;
        setNodeNames(names);
      })
      .catch(() => {});
  }, []);

  const providerName = (id) => nodeNames?.[id] || AI_PROVIDERS[id]?.name || id;
  // A rule can outlive its provider (custom node deleted): say so instead of
  // leaving a bare generated id. Only once the node list has loaded.
  const isRemovedProvider = (id) => nodeNames !== null && !nodeNames[id] && !AI_PROVIDERS[id];

  // autoModelImport is one settings key that the daily sweep also writes
  // (lastRunAt/lastResult), and PATCH /api/settings replaces top-level keys
  // whole. Re-read it right before saving so a stale copy from page load never
  // rolls back lastRunAt (which would let the sweep run twice in one day).
  const saveConfig = async (patch) => {
    setSaving(true);
    setError("");
    try {
      const currentRes = await fetch("/api/models/import/auto");
      if (!currentRes.ok) throw new Error("Failed to load auto-import settings");
      const current = (await currentRes.json()).settings || {};
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoModelImport: { ...current, ...patch } }),
      });
      if (!res.ok) throw new Error("Failed to update auto-import settings");
      const data = await res.json();
      setAutoImportSettings(data.autoModelImport || { ...current, ...patch });
    } catch (err) {
      setError(err?.message || "An error occurred");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = (enabled) => saveConfig({ enabled });

  const handleHourChange = (e) => saveConfig({ hour: parseInt(e.target.value, 10) });

  const handleRunNow = async () => {
    setRunLoading(true);
    setError("");
    try {
      const res = await fetch("/api/models/import/auto", { method: "POST" });

      if (res.ok) {
        const data = await res.json();
        // Update the last run info
        setAutoImportSettings((prev) => ({
          ...prev,
          lastRunAt: data.at,
          lastResult: { at: data.at, providers: data.providers },
        }));
      } else {
        const data = await res.json();
        if (res.status === 409) {
          setError(data.error || "Auto-import is already running");
        } else {
          setError(data.error || "Failed to run auto-import");
        }
      }
    } catch (err) {
      setError("An error occurred while running auto-import");
      console.error(err);
    } finally {
      setRunLoading(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <div className="text-center py-8 text-text-muted">
          <span className="material-symbols-outlined animate-spin text-[24px]">
            progress_activity
          </span>
        </div>
      </Card>
    );
  }

  const hourOptions = Array.from({ length: 24 }, (_, i) => ({
    value: i.toString(),
    label: `${String(i).padStart(2, "0")}:00`,
  }));

  const lastRunAt = autoImportSettings.lastRunAt
    ? new Date(autoImportSettings.lastRunAt).toLocaleString()
    : null;

  const providerIds = Object.keys(importRules);
  const lastResult = autoImportSettings.lastResult;

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="size-10 rounded-lg bg-purple-500/10 text-purple-500 flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-[20px]">
            schedule
          </span>
        </div>
        <div>
          <h3 className="text-base sm:text-lg font-semibold">
            Daily Model Auto-Import
          </h3>
          <p className="text-xs sm:text-sm text-text-muted">
            Automatically import new models from configured providers
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {/* Enable toggle */}
        <div className="flex items-start sm:items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm sm:text-base">
              Enable daily auto-import
            </p>
            <p className="text-xs sm:text-sm text-text-muted">
              Runs at the scheduled hour every day
            </p>
          </div>
          <Toggle
            checked={autoImportSettings.enabled === true}
            onChange={handleToggle}
            disabled={saving}
          />
        </div>

        {/* Hour selector and run button */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1 min-w-0">
            <Select
              label="Run time (server local time)"
              options={hourOptions}
              value={String(autoImportSettings.hour ?? 4)}
              onChange={handleHourChange}
              disabled={saving}
            />
          </div>
          <Button
            onClick={handleRunNow}
            loading={runLoading}
            className="w-full sm:w-auto"
          >
            Run now
          </Button>
        </div>

        {/* Error message */}
        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Last run info */}
        {lastRunAt && lastResult && (
          <div className="pt-4 border-t border-border">
            <p className="text-sm font-medium mb-2">
              <span>Last run</span>: <span className="font-normal text-text-muted">{lastRunAt}</span>
            </p>
            <div className="space-y-2">
              {lastResult.providers && lastResult.providers.length > 0 ? (
                lastResult.providers.map((provider) => (
                  <div
                    key={provider.providerId}
                    className="flex items-start justify-between gap-2 p-2 rounded-lg bg-surface-2"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-xs sm:text-sm font-medium" title={provider.providerId}>
                        {providerName(provider.providerId)}
                      </p>
                      {provider.error && (
                        <ErrorReason error={provider.error} compact className="mt-1 text-xs" />
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1 text-[11px]">
                      <span className="rounded-md bg-green-500/10 px-1.5 py-0.5 text-green-700 dark:text-green-400">
                        {provider.imported || 0} <span>imported</span>
                      </span>
                      {provider.failed > 0 && (
                        <span className="rounded-md bg-red-500/10 px-1.5 py-0.5 text-red-600 dark:text-red-400">
                          {provider.failed} <span>failed</span>
                        </span>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-text-muted">No providers ran</p>
              )}
            </div>
          </div>
        )}

        {/* Rules list */}
        {providerIds.length > 0 && (
          <div className="pt-4 border-t border-border">
            <p className="text-sm font-medium mb-2">Import rules</p>
            <div className="space-y-2">
              {providerIds.map((providerId) => {
                const rule = importRules[providerId];
                return (
                  <Link
                    key={providerId}
                    href={`/dashboard/providers/${providerId}`}
                  >
                    <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-surface-2 hover:bg-surface-3 transition-colors cursor-pointer">
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                        <p className={`truncate text-xs sm:text-sm font-medium ${isRemovedProvider(providerId) ? "text-text-muted" : "text-text-main"}`} title={providerId}>
                          {providerName(providerId)}
                        </p>
                        {isRemovedProvider(providerId) && (
                          <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                            Provider removed
                          </span>
                        )}
                        {rule?.testFirst && (
                          <span className="inline-flex items-center gap-0.5 rounded-md bg-green-500/10 px-1.5 py-0.5 text-[11px] text-green-700 dark:text-green-400">
                            <span className="material-symbols-outlined text-[12px]">science</span>
                            <span>Tests before import</span>
                          </span>
                        )}
                      </div>
                      <span className="material-symbols-outlined shrink-0 text-[18px] text-text-muted">chevron_right</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {providerIds.length === 0 && (
          <div className="pt-4 border-t border-border">
            <p className="text-sm text-text-muted">
              No providers have an auto-import rule yet.
            </p>
          </div>
        )}

        {/* Info note */}
        <div className="p-3 rounded-lg bg-bg border border-border">
          <p className="text-xs text-text-muted leading-relaxed">
            Rules are saved from each provider&apos;s Import models dialog.
            Auto-import only adds new models; it never removes any.
          </p>
        </div>
      </div>
    </Card>
  );
}
