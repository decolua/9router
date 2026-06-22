"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Badge from "./Badge";
import Button from "./Button";
import Input from "./Input";
import Modal from "./Modal";
import logger from "@/lib/logger";

const DEFAULT_CONCURRENCY = 4;
const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "needs_manual"]);
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);

function formatStepLabel(value) {
  return String(value || "waiting").replaceAll("_", " ");
}

function formatClock(value) {
  if (!value) return "now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "now";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getStatusVariant(status) {
  if (status === "success" || status === "completed") return "success";
  if (status === "needs_manual") return "warning";
  if (status === "running" || status === "queued") return "info";
  if (status === "cancelled") return "default";
  return "danger";
}

function AccountStatusBadge({ status }) {
  return (
    <Badge variant={getStatusVariant(status)} size="sm">
      {formatStepLabel(status)}
    </Badge>
  );
}

async function fetchJob(provider, jobId) {
  const res = await fetch(`/api/oauth/${provider}/bulk-import/${jobId}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return { res, data };
}

async function fetchLatestJob(provider, scope = "recoverable") {
  const res = await fetch(
    `/api/oauth/${provider}/bulk-import/latest?scope=${encodeURIComponent(scope)}`,
    {
      cache: "no-store",
    },
  );
  const data = await res.json();
  return { res, data };
}

export default function BulkAccountAutomationModal({
  isOpen,
  onClose,
  onSuccess,
  provider,
  title,
  serviceName,
}) {
  const storageKey = `${provider}-bulk-import-active-job`;
  const completedRefreshJobsRef = useRef(new Set());
  const [bulkText, setBulkText] = useState("");
  const [concurrency, setConcurrency] = useState("auto");
  const [autoDetect, setAutoDetect] = useState(true);
  const [systemSpecs, setSystemSpecs] = useState(null);
  const [engine, setEngine] = useState("playwright");
  const [proxyPoolId, setProxyPoolId] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyPools, setProxyPools] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [jobRestoreNotice, setJobRestoreNotice] = useState(null);

  const runningJob = activeJob && ACTIVE_JOB_STATUSES.has(activeJob.status);
  const finishedJob = activeJob && TERMINAL_JOB_STATUSES.has(activeJob.status);

  const groupedAccounts = useMemo(() => {
    if (!activeJob?.accounts) return new Map();
    const groups = new Map();
    for (const account of activeJob.accounts) {
      const key = account.status || "unknown";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(account);
    }
    return groups;
  }, [activeJob]);

  const resetState = useCallback(() => {
    setBulkText("");
    setConcurrency(
      autoDetect && systemSpecs?.recommendedWorkers
        ? "auto"
        : String(DEFAULT_CONCURRENCY),
    );
    setProxyPoolId("");
    setProxyUrl("");
    setActiveJob(null);
    setError(null);
    setJobRestoreNotice(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(storageKey);
    }
  }, [storageKey, autoDetect, systemSpecs]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const restore = async () => {
      const storedJobId =
        typeof window !== "undefined"
          ? window.localStorage.getItem(storageKey)
          : null;

      if (storedJobId) {
        try {
          const { res, data } = await fetchJob(provider, storedJobId);
          if (!cancelled && res.ok && data?.job && data.recoverable) {
            setActiveJob(data.job);
            setJobRestoreNotice("Restored active job from previous session");
          }
        } catch (err) {
          logger.warn("BULK_IMPORT", "Failed to restore job", {
            error: err.message,
          });
        }
      }

      const latest = await fetchLatestJob(provider);
      if (!cancelled && latest.res.ok && latest.data?.job) {
        setActiveJob(latest.data.job);
        setJobRestoreNotice("Restored latest job");
      }
    };

    restore();
    return () => {
      cancelled = true;
    };
  }, [isOpen, provider, storageKey]);

  useEffect(() => {
    if (!isOpen) return;

    const fetchSpecs = async () => {
      try {
        const res = await fetch("/api/system/specs");
        if (res.ok) {
          const data = await res.json();
          setSystemSpecs(data);
          if (autoDetect && data.recommendedWorkers) {
            setConcurrency(String(data.recommendedWorkers));
          }
        }
      } catch (err) {
        logger.warn("BULK_IMPORT", "Failed to fetch system specs", {
          error: err.message,
        });
      }
    };

    fetchSpecs();
  }, [isOpen, autoDetect]);

  useEffect(() => {
    if (!isOpen || !activeJob?.jobId) return;

    let cancelled = false;
    let timerId = null;

    const poll = async () => {
      try {
        const { data } = await fetchJob(provider, activeJob.jobId);
        if (!cancelled && data?.job) {
          setActiveJob(data.job);

          if (typeof window !== "undefined") {
            window.localStorage.setItem(storageKey, data.job.jobId);
          }

          if (
            TERMINAL_JOB_STATUSES.has(data.job.status) &&
            !completedRefreshJobsRef.current.has(data.job.jobId)
          ) {
            completedRefreshJobsRef.current.add(data.job.jobId);
            onSuccess?.();
            return;
          }

          const interval = getPollInterval(data.job.status);
          if (interval > 0 && !cancelled) {
            timerId = window.setTimeout(poll, interval);
          }
        }
      } catch (err) {
        if (!cancelled) {
          timerId = window.setTimeout(poll, 2000);
        }
      }
    };

    timerId = window.setTimeout(poll, getPollInterval(activeJob.status));

    return () => {
      cancelled = true;
      if (timerId) window.clearTimeout(timerId);
    };
  }, [
    activeJob?.jobId,
    activeJob?.status,
    finishedJob,
    isOpen,
    onSuccess,
    provider,
    storageKey,
  ]);

  const handleStartBulk = async () => {
    const lines = bulkText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      setError("Please enter at least one gmail|password line");
      return;
    }

    setImporting(true);
    setError(null);
    setJobRestoreNotice(null);

    try {
      const concurrencyValue = autoDetect
        ? "auto"
        : Number.parseInt(concurrency, 10) || DEFAULT_CONCURRENCY;

      const postBody = {
        accounts: lines,
        concurrency: concurrencyValue,
        engine,
      };

      if (proxyPoolId) postBody.proxyPoolId = proxyPoolId;
      if (proxyUrl.trim()) postBody.proxyUrl = proxyUrl.trim();

      const res = await fetch(`/api/oauth/${provider}/bulk-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postBody),
      });

      const data = await res.json();

      if (!res.ok) {
        const invalidHint =
          Array.isArray(data.invalidLines) && data.invalidLines.length
            ? ` (invalid lines: ${data.invalidLines.join(", ")})`
            : "";
        setError(data.error || "Failed to start bulk import" + invalidHint);
        return;
      }

      if (data?.job) {
        setActiveJob(data.job);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(storageKey, data.job.jobId);
        }
      }
    } catch (err) {
      setError(err.message || "Network error");
    } finally {
      setImporting(false);
    }
  };

  const handleCancelJob = async () => {
    if (!activeJob?.jobId) return;

    try {
      const res = await fetch(
        `/api/oauth/${provider}/bulk-import/${activeJob.jobId}/cancel`,
        {
          method: "POST",
        },
      );

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to cancel job");
      }
    } catch (err) {
      setError(err.message || "Network error");
    }
  };

  const handleDoneRefresh = () => {
    resetState();
    onSuccess?.();
    onClose?.();
  };

  const handleOpenManualSession = async (workerId) => {
    if (!activeJob?.jobId) return;

    try {
      const res = await fetch(
        `/api/oauth/${provider}/bulk-import/${activeJob.jobId}/manual/${workerId}`,
        { method: "POST" },
      );

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to open manual session");
      }
    } catch (err) {
      setError(err.message || "Network error");
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title || `${serviceName} Bulk Login`}
      size="xl"
    >
      <div className="flex flex-col gap-4">
        {jobRestoreNotice && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {jobRestoreNotice}
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {!activeJob && (
          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-2 block text-sm font-medium">
                Bulk GSuite login runs browser workers in the background. Use
                one account per line in{" "}
                <code className="rounded bg-border/50 px-1">
                  gmail|password
                </code>{" "}
                format. Accounts that hit CAPTCHA, 2FA, or recovery prompts move
                to manual assist.
              </label>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                Bulk Accounts <span className="text-red-500">*</span>
              </label>
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder="account1@gmail.com|password123&#10;account2@gmail.com|password456"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
                rows={8}
              />
              <p className="mt-1 text-xs text-text-muted">
                Only rewrite API URLs, not browser traffic.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium">
                  Concurrency
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="autoDetect"
                    checked={autoDetect}
                    onChange={(e) => setAutoDetect(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="autoDetect" className="text-sm">
                    Auto-detect (
                    {systemSpecs?.recommendedWorkers || DEFAULT_CONCURRENCY}{" "}
                    workers)
                  </label>
                </div>
                {!autoDetect && (
                  <Input
                    type="number"
                    value={concurrency}
                    onChange={(e) => setConcurrency(e.target.value)}
                    min={1}
                    max={8}
                    className="mt-2"
                  />
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  Browser Engine
                </label>
                <select
                  value={engine}
                  onChange={(e) => setEngine(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none"
                >
                  <option value="playwright">Chromium (Playwright)</option>
                  <option value="camoufox">Camoufox (Stealth Firefox)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                Proxy Configuration (Optional)
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  value={proxyPoolId}
                  onChange={(e) => setProxyPoolId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none"
                >
                  <option value="">No proxy pool</option>
                  {proxyPools.map((pool) => (
                    <option key={pool.id} value={pool.id}>
                      {pool.name} ({pool.type})
                    </option>
                  ))}
                </select>
                <Input
                  type="text"
                  value={proxyUrl}
                  onChange={(e) => setProxyUrl(e.target.value)}
                  placeholder="http://user:pass@host:port"
                />
              </div>
            </div>
          </div>
        )}

        {activeJob && (
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="font-semibold">{serviceName} Bulk Login Job</h3>
              <p className="text-xs text-text-muted">
                Job ID: <span className="font-mono">{activeJob.jobId}</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant={getStatusVariant(activeJob.status)}>
                  {activeJob.status}
                </Badge>
                <Badge variant="info">
                  Concurrency: {activeJob.concurrency}
                </Badge>
                {runningJob && <Badge variant="info">Running</Badge>}
                {finishedJob && <Badge variant="success">Finished</Badge>}
              </div>
            </div>

            {activeJob.summary && (
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface p-3 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-text-muted">Total</p>
                  <p className="text-lg font-semibold">
                    {activeJob.summary.total}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-text-muted">Success</p>
                  <p className="text-lg font-semibold text-green-600">
                    {activeJob.summary.success}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-text-muted">Failed</p>
                  <p className="text-lg font-semibold text-red-600">
                    {activeJob.summary.failed}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-text-muted">Needs Manual</p>
                  <p className="text-lg font-semibold text-amber-600">
                    {activeJob.summary.needs_manual}
                  </p>
                </div>
              </div>
            )}

            {activeJob.accounts && activeJob.accounts.length > 0 && (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 text-left">Email</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left">Step</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeJob.accounts.map((account, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-3 py-2 font-mono text-xs">
                          {account.email}
                        </td>
                        <td className="px-3 py-2">
                          <AccountStatusBadge status={account.status} />
                        </td>
                        <td className="px-3 py-2 text-xs text-text-muted">
                          {formatStepLabel(account.currentStep)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {account.status === "needs_manual" &&
                            account.workerId && (
                              <Button
                                size="xs"
                                variant="secondary"
                                onClick={() =>
                                  handleOpenManualSession(account.workerId)
                                }
                              >
                                Open Session
                              </Button>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeJob.activity && activeJob.activity.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-surface p-3">
                <h4 className="mb-2 text-sm font-semibold">Activity Log</h4>
                <div className="space-y-1 text-xs">
                  {[...activeJob.activity].reverse().map((entry, idx) => (
                    <div key={idx} className="flex gap-2">
                      <span className="text-text-muted">
                        {formatClock(entry.at)}
                      </span>
                      <span
                        className={
                          entry.level === "error" ? "text-red-600" : ""
                        }
                      >
                        {entry.message}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeJob.lastPreview && (
              <div className="rounded-lg border border-border p-3">
                <h4 className="mb-2 text-sm font-semibold">
                  Browser Preview ({activeJob.lastPreview.email})
                </h4>
                {activeJob.lastPreview.imageData && (
                  <Image
                    src={activeJob.lastPreview.imageData}
                    alt="Browser preview"
                    width={800}
                    height={600}
                    className="rounded border border-border"
                    unoptimized
                  />
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          {!activeJob && (
            <Button
              onClick={handleStartBulk}
              fullWidth
              disabled={importing || !bulkText.trim()}
            >
              {importing ? "Starting..." : "Start Bulk Login"}
            </Button>
          )}

          {activeJob && !finishedJob && (
            <Button
              onClick={handleCancelJob}
              fullWidth
              variant="secondary"
              disabled={!runningJob}
            >
              {runningJob ? "Cancel Running Job" : "Job Stopped"}
            </Button>
          )}

          {finishedJob && (
            <Button onClick={handleDoneRefresh} fullWidth>
              Done & Refresh Connections
            </Button>
          )}

          <Button
            onClick={activeJob ? resetState : onClose}
            variant="ghost"
            fullWidth
          >
            {activeJob ? "Clear" : "Cancel"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function getPollInterval(status) {
  if (ACTIVE_JOB_STATUSES.has(status)) return 2000;
  if (status === "needs_manual") return 5000;
  return 0;
}
