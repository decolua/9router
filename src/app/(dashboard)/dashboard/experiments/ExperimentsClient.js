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
      <div className="flex flex-col gap-4 max-w-4xl">
        <div>
          <h1 className="text-xl font-bold text-text-main flex items-center gap-2">
            <span className="material-symbols-outlined text-[24px] text-amber-500">science</span>
            Experiment Features
          </h1>
          <p className="text-xs text-text-muted mt-1">
            Experimental capabilities and advanced protection for 9Router.
          </p>
        </div>

        <Card padding="md" className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/40 pb-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-warning/10 text-warning shrink-0 mt-0.5">
                <span className="material-symbols-outlined text-[22px]">visibility_off</span>
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-text-main flex items-center gap-2">
                  Hide Raw Errors
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/30">
                    Experimental
                  </span>
                </span>
                <p className="text-xs text-text-muted mt-1 leading-relaxed">
                  Masks upstream provider errors and stack traces before sending responses to API clients.
                  When enabled, external clients receive:{" "}
                  <code className="text-text-main font-mono text-[11px] bg-surface-2 px-1.5 py-0.5 rounded border border-border">
                    &quot;There is an error but this error is hidden, try checking your error log.&quot;
                  </code>
                  . Original diagnostics and stack traces remain safely stored in the <strong>Error &amp; Console Logs</strong> menu.
                </p>
              </div>
            </div>
            <div className="shrink-0 flex items-center self-end sm:self-center">
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
