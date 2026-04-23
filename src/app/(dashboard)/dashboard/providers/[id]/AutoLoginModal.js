"use client";

import { useRef, useState } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Badge } from "@/shared/components";

function isLikelyRefreshToken(value) {
  return typeof value === "string" && value.trim().startsWith("1//");
}

function parseAccountLine(line) {
  const raw = line.trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("//")) return null;

  const idx = raw.indexOf(":");
  if (idx === -1) return { type: "tokenOnly", raw, refreshToken: raw };

  const email = raw.slice(0, idx).trim();
  const secret = raw.slice(idx + 1).trim();
  if (!email || !secret) return null;

  if (email.includes("@") && isLikelyRefreshToken(secret)) {
    return { type: "emailToken", raw, email, refreshToken: secret };
  }
  if (email.includes("@")) {
    return { type: "emailPassword", raw, email, password: secret };
  }

  return { type: "tokenOnly", raw, refreshToken: raw };
}

/**
 * AutoLoginModal - Bulk import Antigravity accounts
 *
 * Accepts one account per line as email:password or email:refreshToken.
 * Password lines are converted via headless OAuth on the server.
 *
 * Shows real-time streaming logs from the server during processing.
 */
export default function AutoLoginModal({ isOpen, onClose, onSuccess }) {
  const [accountsText, setAccountsText] = useState("");
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");
  const [parallel, setParallel] = useState(1);
  const [runInfo, setRunInfo] = useState(null);
  const [logs, setLogs] = useState([]);
  const [completedCount, setCompletedCount] = useState(0);
  const abortRef = useRef(null);
  const logsEndRef = useRef(null);

  const stopProcessing = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setProcessing(false);
    setError("Stopped by user.");
  };

  const handleSubmit = async () => {
    if (!accountsText.trim()) return;

    setProcessing(true);
    setError("");
    setResults(null);
    setLogs([]);
    setCompletedCount(0);

    try {
      // Parse textarea lines into accounts array
      const parsed = accountsText
        .split("\n")
        .map((line) => parseAccountLine(line))
        .filter(Boolean);

      const readyAccounts = parsed.map((entry) => {
        if (entry.type === "emailPassword") {
          return { email: entry.email, password: entry.password };
        }
        if (entry.type === "emailToken") {
          return { email: entry.email, refreshToken: entry.refreshToken };
        }
        return { refreshToken: entry.refreshToken };
      });

      if (readyAccounts.length === 0) {
        setError("No valid accounts found. Use one account per line.");
        setProcessing(false);
        return;
      }

      const workerCount = Math.min(Math.max(Number.parseInt(parallel, 10) || 1, 1), 5, readyAccounts.length);
      setRunInfo({ total: readyAccounts.length, workers: workerCount });

      const controller = new AbortController();
      abortRef.current = controller;

      const res = await fetch("/api/oauth/antigravity/auto-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ accounts: readyAccounts, parallel: workerCount }),
      });
      abortRef.current = null;

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Auto-login request failed (${res.status})`);
        setProcessing(false);
        return;
      }

      // Read NDJSON stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete last line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);

            if (event.type === "log") {
              setLogs((prev) => [...prev, event]);
            } else if (event.type === "account_done") {
              setCompletedCount((prev) => prev + 1);
              setLogs((prev) => [...prev, {
                type: "log",
                index: event.index,
                email: event.result?.email || "",
                message: event.result?.status === "success"
                  ? `✓ Done (${event.result?.projectId || "no project"})`
                  : `✗ ${event.result?.error || "Failed"}`,
              }]);
            } else if (event.type === "done") {
              setResults(event);
              if (event.summary?.success > 0) {
                onSuccess?.();
              }
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch (e) {
      if (e?.name === "AbortError") {
        setError("Stopped by user.");
      } else {
        setError(`Network error: ${e.message}`);
      }
    } finally {
      abortRef.current = null;
      setProcessing(false);
    }
  };

  const handleClose = () => {
    if (!processing) {
      setAccountsText("");
      setResults(null);
      setError("");
      setRunInfo(null);
      setParallel(1);
      setLogs([]);
      setCompletedCount(0);
      onClose();
    }
  };

  const lineCount = accountsText
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("//")).length;
  const parsedEntries = accountsText
    .split("\n")
    .map((line) => parseAccountLine(line))
    .filter(Boolean);
  const passwordCount = parsedEntries.filter((entry) => entry.type === "emailPassword").length;
  const tokenCount = parsedEntries.filter((entry) => entry.type === "emailToken" || entry.type === "tokenOnly").length;
  const readyCount = passwordCount + tokenCount;

  return (
    <Modal isOpen={isOpen} title="Auto Login - Bulk Import" onClose={handleClose}>
      <div className="flex flex-col gap-4">
        <div className="text-sm text-text-muted space-y-1">
          <p>Paste Antigravity accounts below, one account per line:</p>
          <code className="block bg-black/5 dark:bg-white/5 rounded-lg p-2 text-xs font-mono">
            email@gmail.com:password123
            <br />
            another@gmail.com:1//0refreshToken...
          </code>
          <p className="text-xs">
            Format: <strong>email:password</strong> or <strong>email:refreshToken</strong>. Password lines use headless Puppeteer login automatically.
          </p>
        </div>

        {/* Textarea */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium">Accounts</label>
            <span className="text-xs text-text-muted">
              {lineCount} total | {readyCount} ready | {passwordCount} password | {tokenCount} token
            </span>
          </div>
          <textarea
            className="w-full h-40 px-3 py-2 border border-border rounded-lg bg-background text-sm font-mono resize-y focus:outline-none focus:border-primary"
            placeholder={`email@gmail.com:password123\nemail@gmail.com:1//0refreshToken...`}
            value={accountsText}
            onChange={(e) => setAccountsText(e.target.value)}
            disabled={processing}
            spellCheck={false}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleSubmit}
            disabled={!accountsText.trim() || processing || readyCount === 0}
          >
            {processing ? "Processing..." : "Start"}
          </Button>
          <select
            className="h-9 px-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            value={parallel}
            onChange={(e) => setParallel(Number.parseInt(e.target.value, 10) || 1)}
            disabled={processing}
            title="Parallel workers"
          >
            <option value={1}>1 parallel</option>
            <option value={2}>2 parallel</option>
            <option value={3}>3 parallel</option>
            <option value={5}>5 parallel</option>
          </select>
          <Button onClick={stopProcessing} variant="ghost" disabled={!processing}>
            Stop
          </Button>
        </div>

        {/* Live progress */}
        {processing && runInfo && (
          <div className="text-xs text-text-muted">
            {completedCount}/{runInfo.total} — {runInfo.workers} worker{runInfo.workers > 1 ? "s" : ""}
          </div>
        )}

        {/* Streaming logs */}
        {logs.length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded-lg bg-black/[0.03] dark:bg-white/[0.03] p-2 space-y-0.5">
            {logs.map((log, i) => (
              <div key={i} className="text-[11px] font-mono text-text-muted leading-relaxed flex gap-1.5">
                {log.email && (
                  <span className="text-text-secondary shrink-0 max-w-[180px] truncate" title={log.email}>
                    {log.email}
                  </span>
                )}
                <span className={
                  log.message?.startsWith("✓") ? "text-emerald-500" :
                  log.message?.startsWith("✗") ? "text-red-400" :
                  "text-text-muted"
                }>
                  {log.message}
                </span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {/* Results */}
        {results && (
          <div className="space-y-3">
            {/* Summary */}
            <div className="flex items-center gap-3 text-sm">
              <Badge variant="default" size="sm">
                {results.summary.total} Total
              </Badge>
              {results.summary.success > 0 && (
                <Badge variant="success" size="sm" dot>
                  {results.summary.success} Success
                </Badge>
              )}
              {results.summary.failed > 0 && (
                <Badge variant="error" size="sm" dot>
                  {results.summary.failed} Failed
                </Badge>
              )}
            </div>

            {/* Detail list */}
            <div className="max-h-48 overflow-y-auto space-y-1">
              {results.results.map((r, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-black/[0.03] dark:bg-white/[0.03]"
                >
                  <span
                    className={`material-symbols-outlined text-[16px] ${
                      r.status === "success" ? "text-emerald-500" : "text-red-500"
                    }`}
                  >
                    {r.status === "success" ? "check_circle" : "error"}
                  </span>
                  <span className="flex-1 min-w-0 truncate font-mono">
                    {r.email}
                  </span>
                  {r.projectId && (
                    <span className="text-text-muted truncate max-w-[120px]" title={r.projectId}>
                      {r.projectId}
                    </span>
                  )}
                  {r.workerId && (
                    <span className="text-text-muted">w{r.workerId}</span>
                  )}
                  {r.error && (
                    <span className="text-red-400 truncate max-w-[200px]" title={r.error}>
                      {r.error}
                    </span>
                  )}
                  <span
                    className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                      r.status === "success"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-red-500/15 text-red-400"
                    }`}
                  >
                    {r.status === "success" ? "OK" : "FAIL"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex gap-2">
          <Button onClick={handleClose} variant="ghost" fullWidth disabled={processing}>
            {results ? "Done" : "Cancel"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

AutoLoginModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};
