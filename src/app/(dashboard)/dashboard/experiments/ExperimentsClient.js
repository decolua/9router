"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Toggle, PageShell } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

export default function ExperimentsClient() {
  const [hideError, setHideError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const addNotification = useNotificationStore((state) => state.addNotification);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setHideError(Boolean(data.hideError));
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleToggleHideError = async (checked) => {
    setSaving(true);
    setHideError(checked);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hideError: checked }),
      });
      if (!res.ok) {
        throw new Error("Failed to update setting");
      }
      addNotification({
        type: "success",
        title: "Saved",
        message: `Hide Error feature has been ${checked ? "enabled" : "disabled"}.`,
      });
    } catch (err) {
      setHideError(!checked);
      addNotification({
        type: "error",
        title: "Error",
        message: err.message || "Failed to save settings.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell width="full" className="min-w-0">
      <div className="flex flex-col gap-5 max-w-5xl min-w-0">
        <header className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-text-main flex items-center gap-2">
            <span className="material-symbols-outlined text-[22px] text-amber-500">experiment</span>
            Experiment Features
          </h1>
          <p className="text-xs text-text-muted mt-1">
            Experimental capabilities and advanced protection for 9Router.
          </p>
        </header>

        <Card padding="md" className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 border-b border-border/40 pb-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
            <div className="flex items-start gap-3 sm:col-start-2">
              <div className="p-2 rounded-xl bg-warning/10 text-warning shrink-0 mt-0.5">
                <span className="material-symbols-outlined text-[22px]">shield_lock</span>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-semibold text-text-main flex items-center gap-2 flex-wrap">
                  Hide Raw Errors
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/30">
                    Experimental
                  </span>
                </span>
                <p className="text-sm text-text-muted mt-1.5 leading-relaxed">
                  Masks upstream provider errors and stack traces before sending responses to API clients.
                  When enabled, external clients receive:{" "}
                  <code className="text-text-main font-mono text-xs bg-surface-2 px-1.5 py-0.5 rounded border border-border break-words">
                    &quot;There is an error but this error is hidden, try checking your error log.&quot;
                  </code>
                  . Original diagnostics and stack traces remain safely stored in the <strong>Error &amp; Console Logs</strong> menu.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center self-start sm:col-start-1 sm:row-start-1 sm:self-center sm:pl-4">
              <Toggle
                checked={hideError}
                disabled={loading || saving}
                onChange={handleToggleHideError}
              />
            </div>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
