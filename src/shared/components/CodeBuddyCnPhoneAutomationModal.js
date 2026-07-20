"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import PropTypes from "prop-types";
import Badge from "./Badge";
import Button from "./Button";
import Input from "./Input";
import Modal from "./Modal";
import {
  formatBrowserProxyPoolOption,
  getBrowserProxyPools,
} from "@/lib/oauth/services/bulkImportProxyOptions.js";
import { readJsonResponse } from "@/shared/utils/httpResponse.js";

const PROVIDER = "codebuddy-cn";
const DEFAULT_ENGINE = "chromium";
const ACTIVE_STATUSES = new Set(["queued", "running", "needs_manual"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function formatStep(value) {
  return String(value || "waiting").replaceAll("_", " ");
}

function formatClock(value) {
  if (!value) return "--";
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));
  } catch {
    return "--";
  }
}

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `$${number.toFixed(2)}`;
}

function formatUnitCost(value) {
  if (value === null || value === undefined || value === "") return "--";
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `$${number.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function statusVariant(status) {
  if (status === "success" || status === "completed") return "success";
  if (status === "needs_manual") return "warning";
  if (status === "running" || status === "queued") return "info";
  if (status === "cancelled") return "default";
  return "danger";
}

async function fetchJob(jobId) {
  const res = await fetch(`/api/oauth/${PROVIDER}/bulk-import/${jobId}`, { cache: "no-store" });
  return { res, data: await readJsonResponse(res, "Failed to fetch CodeBuddy CN phone job") };
}

async function fetchLatestJob() {
  const res = await fetch(`/api/oauth/${PROVIDER}/bulk-import/latest?scope=recoverable`, { cache: "no-store" });
  return { res, data: await readJsonResponse(res, "Failed to fetch latest CodeBuddy CN phone job") };
}

async function fetchFiveSimQuote(body, signal) {
  const res = await fetch(`/api/oauth/${PROVIDER}/5sim-quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  return { res, data: await readJsonResponse(res, "Failed to check 5sim balance") };
}

export default function CodeBuddyCnPhoneAutomationModal({ isOpen, onClose, onSuccess }) {
  const storageKey = `${PROVIDER}-phone-import-active-job`;
  const [fiveSimToken, setFiveSimToken] = useState("");
  const [count, setCount] = useState("1");
  const [country, setCountry] = useState("hongkong");
  const [operator, setOperator] = useState("any");
  const [product, setProduct] = useState("codebuddy");
  const [proxyPoolId, setProxyPoolId] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyPools, setProxyPools] = useState([]);
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [fiveSimQuote, setFiveSimQuote] = useState(null);
  const [quoteChecking, setQuoteChecking] = useState(false);
  const [quoteError, setQuoteError] = useState("");

  const active = job && ACTIVE_STATUSES.has(job.status);
  const terminal = job && TERMINAL_STATUSES.has(job.status);
  const requestedCount = Math.min(Number.parseInt(count, 10) || 1, 8);
  const hasUsableFiveSimToken = fiveSimToken.trim().length >= 24;
  const quotePending = hasUsableFiveSimToken && !fiveSimQuote && !quoteError && !job;
  const quoteBlocksStart = quoteChecking || quotePending || Boolean(quoteError) || fiveSimQuote?.canAffordRequested === false;
  const startDisabled = starting || !hasUsableFiveSimToken || quoteBlocksStart;
  const manualAccounts = useMemo(() => (
    (job?.accounts || []).filter((account) => account.manualSessionAvailable)
  ), [job]);

  const reset = useCallback(() => {
    setJob(null);
    setError("");
    if (typeof window !== "undefined") window.localStorage.removeItem(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const loadPools = async () => {
      try {
        const res = await fetch("/api/proxy-pools?isActive=true", { cache: "no-store" });
        if (!res.ok) return;
        const data = await readJsonResponse(res, "Failed to fetch proxy pools");
        if (cancelled) return;
        setProxyPools(getBrowserProxyPools(data));
      } catch {
      }
    };
    void loadPools();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const restore = async () => {
      try {
        const storedJobId = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
        if (storedJobId) {
          const { res, data } = await fetchJob(storedJobId);
          if (!cancelled && res.ok && data?.job && data.recoverable) {
            setJob(data.job);
            return;
          }
        }
        const latest = await fetchLatestJob();
        if (!cancelled && latest.res.ok && latest.data?.job) {
          setJob(latest.data.job);
          if (typeof window !== "undefined") window.localStorage.setItem(storageKey, latest.data.job.jobId);
        }
      } catch {
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [isOpen, storageKey]);

  useEffect(() => {
    if (!isOpen || !job?.jobId || terminal) return undefined;
    const interval = window.setInterval(async () => {
      try {
        const { res, data } = await fetchJob(job.jobId);
        if (res.ok && data?.job) {
          setJob(data.job);
          if (typeof window !== "undefined") window.localStorage.setItem(storageKey, data.job.jobId);
          if (TERMINAL_STATUSES.has(data.job.status)) onSuccess?.();
        }
      } catch {
      }
    }, 2_000);
    return () => window.clearInterval(interval);
  }, [isOpen, job?.jobId, onSuccess, storageKey, terminal]);

  useEffect(() => {
    if (!isOpen || job) return undefined;
    const token = fiveSimToken.trim();
    if (!token || token.length < 24) {
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setQuoteChecking(true);
      setQuoteError("");
      try {
        const body = {
          fiveSimToken: token,
          count,
          country,
          operator,
          product,
        };
        if (proxyPoolId) {
          body.proxyPoolId = proxyPoolId;
        } else if (proxyUrl.trim()) {
          body.proxyUrl = proxyUrl.trim();
        }
        const { res, data } = await fetchFiveSimQuote(body, controller.signal);
        if (!res.ok || data.error) throw new Error(data.error || "Failed to check 5sim balance");
        setFiveSimQuote(data.quote || null);
      } catch (err) {
        if (err.name === "AbortError") return;
        setFiveSimQuote(null);
        setQuoteError(err.message || "Failed to check 5sim balance");
      } finally {
        if (!controller.signal.aborted) setQuoteChecking(false);
      }
    }, 650);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [count, country, fiveSimToken, isOpen, job, operator, product, proxyPoolId, proxyUrl]);

  const startJob = async () => {
    setStarting(true);
    setError("");
    try {
      const body = {
        fiveSimToken,
        count,
        country,
        operator,
        product,
        concurrency: Math.min(Number.parseInt(count, 10) || 1, 4),
        engine: DEFAULT_ENGINE,
      };
      if (proxyPoolId) {
        body.proxyPoolId = proxyPoolId;
      } else if (proxyUrl.trim()) {
        body.proxyUrl = proxyUrl.trim();
      }

      const res = await fetch(`/api/oauth/${PROVIDER}/bulk-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJsonResponse(res, "CodeBuddy CN phone automation failed");
      if (!res.ok || data.error) throw new Error(data.error || "CodeBuddy CN phone automation failed");
      setJob(data.job);
      if (data.job?.jobId && typeof window !== "undefined") {
        window.localStorage.setItem(storageKey, data.job.jobId);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  };

  const cancelJob = async () => {
    if (!job?.jobId) return;
    try {
      const res = await fetch(`/api/oauth/${PROVIDER}/bulk-import/${job.jobId}/cancel`, { method: "POST" });
      const data = await readJsonResponse(res, "Failed to cancel job");
      if (!res.ok) throw new Error(data.error || "Failed to cancel job");
      if (data?.job) setJob(data.job);
    } catch (err) {
      setError(err.message);
    }
  };

  const openManual = async (workerId) => {
    if (!job?.jobId || !workerId) return;
    try {
      const res = await fetch(`/api/oauth/${PROVIDER}/bulk-import/${job.jobId}/manual/${workerId}`, { method: "POST" });
      const data = await readJsonResponse(res, "Failed to open manual browser session");
      if (!res.ok || data.error) throw new Error(data.error || "Failed to open manual browser session");
      if (data?.job) setJob(data.job);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal isOpen={isOpen} title="CodeBuddy CN 5sim Phone OTP" onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        {!job && (
          <>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
              Uses 5sim only to buy/read the SMS OTP. The saved CodeBuddy CN key is generated after phone login from the authenticated browser session on <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">www.codebuddy.cn/profile/keys</code>.
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">5sim API Token <span className="text-red-500">*</span></label>
              <Input
                type="password"
                value={fiveSimToken}
                onChange={(event) => {
                  const nextToken = event.target.value;
                  setFiveSimToken(nextToken);
                  if (nextToken.trim().length < 24) {
                    setFiveSimQuote(null);
                    setQuoteError("");
                    setQuoteChecking(false);
                  }
                }}
                placeholder="Paste 5sim bearer token"
              />
              <div className="mt-3 rounded-xl border border-border bg-sidebar p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[18px] text-primary">account_balance_wallet</span>
                      <p className="text-sm font-semibold text-text-main">5sim readiness</p>
                      {quoteChecking && <Badge variant="info" size="sm">checking</Badge>}
                      {fiveSimQuote && !quoteChecking && (
                        <Badge variant={fiveSimQuote.canAffordRequested ? "success" : "warning"} size="sm">
                          {fiveSimQuote.canAffordRequested ? "ready" : "limited"}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                      Checks token validity, balance, live CodeBuddy price, and how many accounts this balance can buy.
                    </p>
                  </div>
                  <div className="text-xs text-text-muted sm:text-right">
                    <p>Target: {requestedCount} account{requestedCount === 1 ? "" : "s"}</p>
                    <p>{country || "hongkong"} / {operator || "any"} / {product || "codebuddy"}</p>
                  </div>
                </div>

                {fiveSimQuote && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                    <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Balance</p>
                      <p className="mt-1 text-sm font-semibold text-text-main">{formatMoney(fiveSimQuote.balance)}</p>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Unit price</p>
                      <p className="mt-1 text-sm font-semibold text-text-main">{formatUnitCost(fiveSimQuote.unitCost)}</p>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Can buy</p>
                      <p className="mt-1 text-sm font-semibold text-text-main">{fiveSimQuote.purchasableByBalance || 0}</p>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Available</p>
                      <p className="mt-1 text-sm font-semibold text-text-main">{fiveSimQuote.availableCount || 0}</p>
                    </div>
                  </div>
                )}

                {fiveSimQuote?.selectedOffer && (
                  <p className="mt-3 text-xs text-text-muted">
                    Selected operator <code className="rounded bg-background px-1">{fiveSimQuote.selectedOffer.operator}</code>. Capacity is balance-limited to {fiveSimQuote.capacity} account{fiveSimQuote.capacity === 1 ? "" : "s"} for this product.
                  </p>
                )}
                {fiveSimQuote?.proxyRoute && (
                  <p className="mt-2 text-xs text-text-muted">
                    Checked via {fiveSimQuote.proxyRoute}{fiveSimQuote.quoteFallbackUsed ? " after fallback" : ""}.
                  </p>
                )}
                {fiveSimQuote?.noStockMessage && (
                  <div className="mt-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-600 dark:text-yellow-400">
                    {fiveSimQuote.noStockMessage}
                  </div>
                )}
                {fiveSimQuote && !fiveSimQuote.canAffordRequested && (
                  <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
                    Requested {fiveSimQuote.requestedCount} account{fiveSimQuote.requestedCount === 1 ? "" : "s"}, but this balance can safely buy {fiveSimQuote.capacity}. Reduce Number Count or add 5sim balance before starting.
                  </div>
                )}
                {quoteError && (
                  <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
                    {quoteError}
                  </div>
                )}
              </div>
              <div className="mt-2 rounded-lg border border-border bg-sidebar p-3 text-xs text-text-muted">
                <p className="font-medium text-text-main">Where to get it</p>
                <p className="mt-1">
                  Open 5sim, sign in, go to the API/Profile token page, then copy the bearer API token. This is the token used for 5sim REST requests, not a CodeBuddy key.
                </p>
                <p className="mt-2 font-medium text-text-main">Requirements</p>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  <li>5sim balance is enough to buy the selected product number.</li>
                  <li>The selected country/operator has the <code className="rounded bg-background px-1">codebuddy</code> product available.</li>
                  <li>The phone number can receive SMS OTP, and the proxy/IP is not restricted by CodeBuddy CN.</li>
                </ul>
                <p className="mt-2">Stored only for this runtime job; it is not written into the job snapshot.</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium">Number Count</label>
                <Input type="number" min="1" max="8" value={count} onChange={(event) => setCount(event.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Country</label>
                <Input value={country} onChange={(event) => setCountry(event.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Operator</label>
                <Input value={operator} onChange={(event) => setOperator(event.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Product</label>
                <Input value={product} onChange={(event) => setProduct(event.target.value)} />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-background/70 p-3 text-xs text-text-muted">
              <p className="font-medium text-text-main">How count works</p>
              <p className="mt-1">
                Number Count maps one-to-one to CodeBuddy CN accounts. A count of {requestedCount} buys {requestedCount} 5sim number{requestedCount === 1 ? "" : "s"}, runs {requestedCount} phone login{requestedCount === 1 ? "" : "s"}, creates {requestedCount} CodeBuddy CN API key{requestedCount === 1 ? "" : "s"}, then saves {requestedCount} provider connection{requestedCount === 1 ? "" : "s"}. Concurrency controls how many workers run at once.
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Network Proxy (optional)</label>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-text-muted">Proxy Pool</label>
                  <select
                    value={proxyPoolId}
                    onChange={(event) => {
                      setProxyPoolId(event.target.value);
                      if (event.target.value) setProxyUrl("");
                    }}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">None</option>
                    {proxyPools.map((pool) => (
                      <option key={pool.id} value={pool.id} disabled={!pool.browserCompatible}>
                        {formatBrowserProxyPoolOption(pool)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-muted">Custom Proxy URL</label>
                  <Input
                    type="text"
                    value={proxyUrl}
                    onChange={(event) => setProxyUrl(event.target.value)}
                    disabled={Boolean(proxyPoolId)}
                    placeholder="http://user:pass@host:port"
                  />
                </div>
              </div>
              <p className="mt-1 text-xs text-text-muted">
                HTTP/SOCKS pools are shown here. Put multiple proxies in a pool or custom field separated by newline/comma; workers rotate them round-robin.
              </p>
            </div>
          </>
        )}

        {job && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-sidebar p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariant(job.status)}>{formatStep(job.status)}</Badge>
                    <span className="text-sm font-semibold">Job {job.jobId}</span>
                  </div>
                  <p className="mt-2 text-xs text-text-muted">
                    Success {job.summary?.success || 0}/{job.summary?.total || 0}; failed {job.summary?.failed || 0}; manual {job.summary?.needs_manual || 0}.
                  </p>
                  <p className="mt-1 text-xs text-text-muted">
                    Proxy: {job.proxyMode === "round-robin" ? `round-robin (${job.proxyCount || 0})` : (job.proxyMode || "none")}
                  </p>
                </div>
                <div className="flex gap-2">
                  {active && <Button size="sm" variant="secondary" onClick={cancelJob}>Cancel</Button>}
                  {terminal && <Button size="sm" onClick={() => { reset(); onSuccess?.(); }}>Done</Button>}
                  <Button size="sm" variant="ghost" onClick={reset}>Clear</Button>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-sidebar">
              <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">Live Browser Preview</p>
                  <p className="text-xs text-text-muted">
                    {job.preview?.email || "Waiting for worker"}
                    {job.preview?.workerId ? ` | Worker ${job.preview.workerId}` : ""}
                  </p>
                </div>
                <div className="text-left text-xs text-text-muted sm:text-right">
                  <p>{formatStep(job.preview?.step)}</p>
                  <p>Updated {formatClock(job.preview?.updatedAt)}</p>
                </div>
              </div>
              <div className="relative bg-black/90">
                {job.preview?.imageData ? (
                  <Image
                    src={job.preview.imageData}
                    alt={`Live CodeBuddy CN worker preview for ${job.preview.email || "phone login"}`}
                    width={1440}
                    height={900}
                    unoptimized
                    className="h-[320px] w-full object-contain"
                  />
                ) : (
                  <div className="flex h-[320px] flex-col items-center justify-center gap-3 px-6 text-center text-slate-200">
                    <span className="material-symbols-outlined text-5xl text-primary/80">browser_updated</span>
                    <div>
                      <p className="text-base font-medium">Preview will appear when a worker opens CodeBuddy CN</p>
                      <p className="mt-1 text-sm text-slate-400">The job keeps running even when a screenshot is not available yet.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {manualAccounts.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                Manual assist is needed. Open the browser worker, finish the phone/CAPTCHA prompt, and the job will continue.
                <div className="mt-3 flex flex-wrap gap-2">
                  {manualAccounts.map((account) => (
                    <Button key={`${account.workerId}-${account.email}`} size="sm" variant="secondary" onClick={() => openManual(account.workerId)}>
                      Open Worker {account.workerId}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              {(job.accounts || []).map((account) => (
                <div key={`${account.line}-${account.email}`} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs">{account.email}</span>
                    <Badge variant={statusVariant(account.status)} size="sm">{formatStep(account.status)}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">{formatStep(account.currentStep)}</p>
                  {account.error && <p className="mt-1 text-xs text-red-400">{account.error}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}

        {!job && (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button onClick={startJob} disabled={startDisabled}>
              {starting ? "Starting..." : `Start ${requestedCount} Phone OTP Automation${requestedCount === 1 ? "" : "s"}`}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

CodeBuddyCnPhoneAutomationModal.propTypes = {
  isOpen: PropTypes.bool,
  onClose: PropTypes.func,
  onSuccess: PropTypes.func,
};
