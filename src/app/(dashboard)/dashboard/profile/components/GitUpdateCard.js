"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Card } from "@/shared/components";

const PHASE_LABELS = {
  starting: "Starting update...",
  pulling: "Downloading update...",
  building: "Preparing update...",
  done: "Update completed successfully.",
  error: "Update failed.",
};

function shortCommit(value) {
  return value ? value.slice(0, 8) : "—";
}

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Update request failed");
  return data;
}

export default function GitUpdateCard() {
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const startedHereRef = useRef(false);
  const reloadScheduledRef = useRef(false);

  const loadStatus = useCallback(async (refresh, quiet = false) => {
    if (!quiet) setChecking(true);
    try {
      const response = await fetch(`/api/version/git-update?refresh=${refresh ? "1" : "0"}`, {
        cache: "no-store",
      });
      const data = await parseResponse(response);
      setStatus(data);

      if (data.operation?.status === "error") {
        setFeedback({ type: "error", message: data.operation.error || "Update failed" });
      } else if (data.operation?.status === "success") {
        setFeedback({ type: "success", message: data.operation.message || "Update completed successfully" });
        if (startedHereRef.current && !reloadScheduledRef.current) {
          reloadScheduledRef.current = true;
          setTimeout(() => globalThis.location.reload(), 1500);
        }
      } else if (!quiet) {
        if (data.updateAvailable) {
          setFeedback({
            type: data.canUpdate ? "success" : "warning",
            message: data.canUpdate
              ? `${data.behind} update commit${data.behind === 1 ? "" : "s"} available.`
              : data.blockedReason,
          });
        } else {
          setFeedback({ type: "success", message: "9Router is already up to date." });
        }
      }
      return data;
    } catch (error) {
      if (!quiet) setFeedback({ type: "error", message: error.message });
      return null;
    } finally {
      if (!quiet) setChecking(false);
    }
  }, []);

  useEffect(() => {
    loadStatus(false, true);
  }, [loadStatus]);

  const updateRunning = status?.operation?.status === "running" || status?.updateInProgress;

  useEffect(() => {
    if (!updateRunning) return undefined;
    const timer = setInterval(() => loadStatus(false, true), 2500);
    return () => clearInterval(timer);
  }, [loadStatus, updateRunning]);

  const handleUpdate = async () => {
    const confirmed = globalThis.confirm(
      "Update 9Router now? The dashboard may be unavailable briefly while the update is installed.",
    );
    if (!confirmed) return;

    setStarting(true);
    setFeedback({ type: "", message: "" });
    startedHereRef.current = true;
    try {
      const response = await fetch("/api/version/git-update", { method: "POST" });
      const data = await parseResponse(response);
      setStatus((current) => ({
        ...current,
        updateInProgress: true,
        operation: data.operation,
      }));
      setFeedback({ type: "warning", message: "Update started. Keep this page open while the service rebuilds." });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
      await loadStatus(false, true);
    } finally {
      setStarting(false);
    }
  };

  const operation = status?.operation;
  const phaseMessage = operation?.message
    || (operation?.phase === "restarting" ? "Restarting application..." : PHASE_LABELS[operation?.phase]);
  const feedbackClass = feedback.type === "error"
    ? "text-red-500 border-red-500/20 bg-red-500/10"
    : feedback.type === "warning"
      ? "text-amber-600 dark:text-amber-400 border-amber-500/20 bg-amber-500/10"
      : "text-green-600 dark:text-green-400 border-green-500/20 bg-green-500/10";

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="size-10 rounded-lg bg-purple-500/10 text-purple-500 flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-[20px]">system_update_alt</span>
        </div>
        <div>
          <h3 className="text-base sm:text-lg font-semibold">Application Update</h3>
          <p className="text-xs sm:text-sm text-text-muted">Check for new versions and keep 9Router up to date.</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {status?.repositoryAvailable && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-lg border border-border bg-bg p-3">
              <p className="text-xs text-text-muted">Current branch</p>
              <p className="text-sm font-medium mt-1">{status.branch}</p>
              <code className="text-xs text-text-muted">{shortCommit(status.currentCommit)}</code>
            </div>
            <div className="rounded-lg border border-border bg-bg p-3">
              <p className="text-xs text-text-muted">Remote branch</p>
              <p className="text-sm font-medium mt-1">{status.upstream}</p>
              <code className="text-xs text-text-muted">{shortCommit(status.remoteCommit)}</code>
            </div>
          </div>
        )}

        {updateRunning && (
          <div className="flex items-center gap-3 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3 text-blue-600 dark:text-blue-400">
            <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
            <div>
              <p className="text-sm font-medium">{phaseMessage || "Update in progress..."}</p>
              <p className="text-xs opacity-80">The dashboard may disconnect briefly during the PM2 restart.</p>
            </div>
          </div>
        )}

        {feedback.message && !updateRunning && (
          <div className={`rounded-lg border p-3 text-sm ${feedbackClass}`}>
            {feedback.message}
          </div>
        )}

        <div className="flex flex-col gap-2 pt-1">
          <Button
            variant="secondary"
            icon="refresh"
            loading={checking}
            disabled={starting || updateRunning}
            onClick={() => loadStatus(true)}
            className="w-full"
          >
            Check for updates
          </Button>
          {status?.updateAvailable && (
            <Button
              variant="success"
              icon="system_update_alt"
              loading={starting}
              disabled={!status.canUpdate || updateRunning || checking}
              onClick={handleUpdate}
              className="w-full"
            >
              Update now
            </Button>
          )}
        </div>

      </div>
    </Card>
  );
}
