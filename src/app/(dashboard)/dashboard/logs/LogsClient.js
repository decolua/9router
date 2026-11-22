"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Card, Button, Badge, SegmentedControl, PageShell } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";
import { stripEmoji } from "@/shared/utils/plainText";

function getStatusBadge(code) {
  const num = Number(code) || 500;
  if (num >= 500) {
    return {
      variant: "error",
      label: `${num} Server Error`,
    };
  }
  if (num === 429) {
    return {
      variant: "warning",
      label: "429 Rate Limit",
    };
  }
  if (num === 401 || num === 403) {
    return {
      variant: "primary",
      label: num === 403 ? "403 Forbidden" : "401 Unauthorized",
    };
  }
  return {
    variant: "default",
    label: `${num} Error`,
  };
}

function parseConsoleItem(line, index) {
  let tag = "LOG";
  let variant = "default";

  if (line.includes("[ERROR]") || line.includes("✗") || line.includes("Error:") || line.includes("FAILED")) {
    tag = "ERROR";
    variant = "error";
  } else if (line.includes("[WARN]") || line.includes("⚠️")) {
    tag = "WARN";
    variant = "warning";
  } else if (line.includes("[INFO]") || line.includes("▶") || line.includes("ℹ️")) {
    tag = "INFO";
    variant = "primary";
  } else if (line.includes("[DB]")) {
    tag = "DATABASE";
    variant = "primary";
  } else if (line.includes("[SYS]") || line.includes("[ROUTER]")) {
    tag = "SYSTEM";
    variant = "default";
  } else if (line.includes("✓") || line.includes("done") || line.includes("SUCCESS")) {
    tag = "SUCCESS";
    variant = "success";
  }

  let timestamp = null;
  const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?|\d{2}:\d{2}:\d{2})/);
  if (tsMatch) {
    timestamp = tsMatch[1];
  }

  return {
    index,
    raw: line,
    tag,
    variant,
    timestamp,
  };
}

export default function LogsClient({ initialTab = "errors" }) {
  const searchParams = useSearchParams();
  const queryTab = searchParams?.get("tab");
  const [activeTab, setActiveTab] = useState(queryTab || initialTab);

  /* --- Console Stream State --- */
  const [consoleLogs, setConsoleLogs] = useState([]);
  const [consoleConnected, setConsoleConnected] = useState(false);
  const [consoleFilter, setConsoleFilter] = useState("");
  const [consoleLevel, setConsoleLevel] = useState("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const [consoleCopiedId, setConsoleCopiedId] = useState(null);
  const consoleRef = useRef(null);

  /* --- Error Records State --- */
  const [errorLogs, setErrorLogs] = useState([]);
  const [errorsLoading, setErrorsLoading] = useState(true);
  const [errorSearch, setErrorSearch] = useState("");
  const [errorStatusFilter, setErrorStatusFilter] = useState("all");
  const [expandedErrorIds, setExpandedErrorIds] = useState(new Set());
  const [errorCopiedId, setErrorCopiedId] = useState(null);

  /* Connect to SSE Console Stream */
  useEffect(() => {
    const es = new EventSource("/api/translator/console-logs/stream");
    es.onopen = () => setConsoleConnected(true);
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "init") {
          setConsoleLogs(msg.logs.slice(-CONSOLE_LOG_CONFIG.maxLines));
        } else if (msg.type === "line") {
          setConsoleLogs((prev) => {
            const next = [...prev, msg.line];
            return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
          });
        } else if (msg.type === "lines") {
          setConsoleLogs((prev) => {
            const next = [...prev, ...msg.lines];
            return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
          });
        } else if (msg.type === "clear") {
          setConsoleLogs([]);
        }
      } catch {
        /* fail open */
      }
    };
    es.onerror = () => setConsoleConnected(false);
    return () => es.close();
  }, []);

  /* Auto-scroll console */
  useEffect(() => {
    if (!autoScroll || !consoleRef.current || activeTab !== "console") return;
    consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [consoleLogs, autoScroll, activeTab]);

  /* Fetch Error Logs */
  const fetchErrorLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/error-logs", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setErrorLogs(data.logs || []);
      }
    } catch (err) {
      console.error("Failed to load error logs:", err);
    } finally {
      setErrorsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchErrorLogs();
    const interval = setInterval(fetchErrorLogs, 6000);
    return () => clearInterval(interval);
  }, [fetchErrorLogs]);

  /* Actions */
  const handleClearConsole = async () => {
    if (!window.confirm("Clear all console stream logs?")) return;
    try {
      await fetch("/api/translator/console-logs", { method: "DELETE" });
      setConsoleLogs([]);
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  };

  const copyText = (text, id, setter) => {
    navigator.clipboard.writeText(text);
    setter(id);
    setTimeout(() => setter(null), 2000);
  };

  const handleCopyAllConsole = () => {
    const text = filteredConsoleItems.map((item) => item.raw).join("\n");
    copyText(text, "all-console", setConsoleCopiedId);
  };

  const handleClearErrors = async () => {
    if (!window.confirm("Clear all recorded error entries?")) return;
    try {
      const res = await fetch("/api/error-logs", { method: "DELETE" });
      if (res.ok) setErrorLogs([]);
    } catch (err) {
      console.error("Failed to clear error logs:", err);
    }
  };

  const handleCopyAllErrors = () => {
    const formatted = filteredErrorLogs
      .map(
        (l) =>
          `[${l.timestamp}] [${l.statusCode}] ${l.provider || "gateway"}/${l.model || "none"}: ${l.errorMessage}${
            l.stack ? `\n\nStack:\n${l.stack}` : ""
          }`
      )
      .join("\n\n---\n\n");
    copyText(formatted, "all-errors", setErrorCopiedId);
  };

  const toggleErrorExpand = (id) => {
    setExpandedErrorIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* Parsed and Filtered Console Items */
  const consoleMetrics = useMemo(() => {
    let errors = 0;
    let warns = 0;
    let info = 0;
    for (const line of consoleLogs) {
      if (line.includes("[ERROR]") || line.includes("✗") || line.includes("Error:") || line.includes("FAILED")) errors++;
      else if (line.includes("[WARN]") || line.includes("⚠️")) warns++;
      else if (line.includes("[INFO]") || line.includes("[DB]") || line.includes("[SYS]")) info++;
    }
    return {
      total: consoleLogs.length,
      errors,
      warns,
      info,
    };
  }, [consoleLogs]);

  const filteredConsoleItems = useMemo(() => {
    return consoleLogs
      .map((line, idx) => parseConsoleItem(line, idx))
      .filter((item) => {
        if (consoleLevel === "error" && item.tag !== "ERROR") return false;
        if (consoleLevel === "warn" && item.tag !== "WARN") return false;
        if (consoleLevel === "info" && item.tag !== "INFO" && item.tag !== "DATABASE" && item.tag !== "SYSTEM") return false;

        if (!consoleFilter) return true;
        return item.raw.toLowerCase().includes(consoleFilter.toLowerCase());
      });
  }, [consoleLogs, consoleFilter, consoleLevel]);

  /* Error Metrics & Filtering */
  const errorMetrics = useMemo(() => {
    let server5xx = 0;
    let rate429 = 0;
    let auth4xx = 0;
    for (const l of errorLogs) {
      const c = Number(l.statusCode) || 500;
      if (c >= 500) server5xx++;
      else if (c === 429) rate429++;
      else if (c === 401 || c === 403) auth4xx++;
    }
    return {
      total: errorLogs.length,
      server5xx,
      rate429,
      auth4xx,
    };
  }, [errorLogs]);

  const filteredErrorLogs = useMemo(() => {
    return errorLogs.filter((l) => {
      const code = Number(l.statusCode) || 500;
      if (errorStatusFilter === "5xx" && code < 500) return false;
      if (errorStatusFilter === "429" && code !== 429) return false;
      if (errorStatusFilter === "auth" && code !== 401 && code !== 403) return false;

      if (!errorSearch) return true;
      const term = errorSearch.toLowerCase();
      return (
        (l.errorMessage || "").toLowerCase().includes(term) ||
        (l.provider || "").toLowerCase().includes(term) ||
        (l.model || "").toLowerCase().includes(term) ||
        String(l.statusCode || "").includes(term)
      );
    });
  }, [errorLogs, errorSearch, errorStatusFilter]);

  return (
    <PageShell width="full" className="min-w-0">
      <div className="flex flex-col gap-5 max-w-6xl">
        {/* Main Header & Dual Tab Switcher */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 rounded-2xl border border-border-subtle px-4 py-4 sm:px-5">
          <div>
            <h1 className="text-xl font-bold text-text-main flex items-center gap-2">
              <span className="material-symbols-outlined text-[22px] text-primary">summarize</span>
              Error &amp; Console Logs
            </h1>
            <p className="text-xs text-text-muted mt-0.5">
              System output and exception logs
            </p>
          </div>

          <SegmentedControl
            options={[
              { value: "errors", label: `Error Records (${errorLogs.length})`, icon: "medical_information" },
              { value: "console", label: `Live Console (${consoleLogs.length})`, icon: "developer_board" },
            ]}
            value={activeTab}
            onChange={setActiveTab}
            className="self-start sm:self-auto"
          />
        </div>

        {/* TAB 1: ERROR RECORDS */}
        {activeTab === "errors" && (
          <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] lg:items-start">
            {/* Quick Metrics */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 lg:col-start-1 lg:row-span-2 lg:grid-cols-1">
              <Card padding="xs" className="flex flex-col">
                <span className="text-[11px] text-text-muted uppercase font-medium tracking-wide">Total Errors</span>
                <span className="text-xl font-bold text-text-main font-mono mt-0.5">{errorMetrics.total}</span>
              </Card>
              <Card padding="xs" className="flex flex-col">
                <span className="text-[11px] text-danger uppercase font-medium tracking-wide">5xx Server</span>
                <span className="text-xl font-bold text-danger font-mono mt-0.5">{errorMetrics.server5xx}</span>
              </Card>
              <Card padding="xs" className="flex flex-col">
                <span className="text-[11px] text-warning uppercase font-medium tracking-wide">429 Rate Limits</span>
                <span className="text-xl font-bold text-warning font-mono mt-0.5">{errorMetrics.rate429}</span>
              </Card>
              <Card padding="xs" className="flex flex-col">
                <span className="text-[11px] text-primary uppercase font-medium tracking-wide">401/403 Auth</span>
                <span className="text-xl font-bold text-primary font-mono mt-0.5">{errorMetrics.auth4xx}</span>
              </Card>
            </div>

            {/* Standard 9Router Search & Filter Row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 lg:col-start-2 lg:row-start-1">
              <div className="relative flex-1 sm:max-w-sm">
                <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-text-muted">
                  find_in_page
                </span>
                <input
                  type="text"
                  value={errorSearch}
                  onChange={(e) => setErrorSearch(e.target.value)}
                  placeholder="Filter by message, model, or status..."
                  className="w-full rounded-[10px] border border-border-subtle bg-surface-2 py-2 pl-9 pr-8 text-xs text-text-main placeholder-text-muted/60 transition-colors focus:border-brand-500/50 focus:outline-none focus:ring-1 focus:ring-brand-500/30 font-sans"
                />
                {errorSearch && (
                  <button
                    type="button"
                    onClick={() => setErrorSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main p-0.5"
                  >
                    <span className="material-symbols-outlined text-[15px]">cancel</span>
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <SegmentedControl
                  size="sm"
                  options={[
                    { value: "all", label: `All (${errorLogs.length})` },
                    { value: "5xx", label: `5xx (${errorMetrics.server5xx})` },
                    { value: "429", label: `429 (${errorMetrics.rate429})` },
                    { value: "auth", label: `Auth (${errorMetrics.auth4xx})` },
                  ]}
                  value={errorStatusFilter}
                  onChange={setErrorStatusFilter}
                />

                {errorLogs.length > 0 && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      icon={errorCopiedId === "all-errors" ? "task_alt" : "file_copy"}
                      onClick={handleCopyAllErrors}
                    >
                      {errorCopiedId === "all-errors" ? "Copied" : "Copy"}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      icon="delete_sweep"
                      onClick={handleClearErrors}
                    >
                      Clear
                    </Button>
                  </>
                )}
                <Button size="sm" variant="ghost" icon="sync" onClick={fetchErrorLogs} title="Refresh" />
              </div>
            </div>

            {/* Error List */}
            <Card padding="none" className="divide-y divide-border-subtle max-h-[calc(100dvh-320px)] overflow-y-auto lg:col-start-2 lg:row-start-2">
              {errorsLoading ? (
                <div className="py-16 text-center text-xs text-text-muted">Loading recorded errors...</div>
              ) : filteredErrorLogs.length === 0 ? (
                <div className="py-16 text-center text-xs text-text-muted">
                  {errorLogs.length === 0 ? "No error records logged." : "No records match search."}
                </div>
              ) : (
                filteredErrorLogs.map((log) => {
                  const badgeInfo = getStatusBadge(log.statusCode);
                  const isExpanded = expandedErrorIds.has(log.id);

                  return (
                    <div key={log.id} className="p-3.5 text-xs transition-colors hover:bg-surface-2/40">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 flex-1 min-w-0">
                          <Badge variant={badgeInfo.variant} size="sm" className="mt-0.5 shrink-0 font-mono">
                            {badgeInfo.label}
                          </Badge>

                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted font-mono">
                              <span>{log.timestamp}</span>
                              {(log.provider || log.model) && (
                                <span className="text-primary font-semibold">
                                  {log.provider ? `${log.provider}/` : ""}{log.model || ""}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-sm text-text-main font-medium break-words leading-relaxed font-sans">
                              {log.errorMessage}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => copyText(
                              `[${log.timestamp}] [${log.statusCode}] ${log.provider}/${log.model}: ${log.errorMessage}${
                                log.stack ? `\n\nStack:\n${log.stack}` : ""
                              }`,
                              log.id,
                              setErrorCopiedId
                            )}
                            className="p-1 rounded text-text-muted hover:text-text-main transition-colors"
                            title="Copy error"
                          >
                            <span className="material-symbols-outlined text-[16px]">
                              {errorCopiedId === log.id ? "task_alt" : "file_copy"}
                            </span>
                          </button>

                          {log.stack && (
                            <button
                              type="button"
                              onClick={() => toggleErrorExpand(log.id)}
                              className="p-1 rounded text-text-muted hover:text-text-main transition-colors"
                              title={isExpanded ? "Hide stack" : "View stack"}
                            >
                              <span className="material-symbols-outlined text-[16px]">
                                {isExpanded ? "keyboard_arrow_up" : "keyboard_arrow_down"}
                              </span>
                            </button>
                          )}
                        </div>
                      </div>

                      {isExpanded && log.stack && (
                        <div className="mt-2.5 p-3 rounded-[var(--r-control)] bg-surface-2 text-text-main font-mono text-[11px] overflow-x-auto whitespace-pre-wrap border border-border-subtle">
                          <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1 font-sans font-semibold">
                            Stack Trace
                          </div>
                          {log.stack}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </Card>
          </div>
        )}

        {/* TAB 2: LIVE CONSOLE STREAM (DESIGN IDENTICAL TO ERROR RECORDS) */}
        {activeTab === "console" && (
          <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] lg:items-start">
            {/* Quick Metrics Bar (Identical layout to Error Records) */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 lg:col-start-1 lg:row-span-2 lg:grid-cols-1">
              <Card padding="xs" className="flex flex-col">
                <span className="text-[11px] text-text-muted uppercase font-medium tracking-wide">Total Lines</span>
                <span className="text-xl font-bold text-text-main font-mono mt-0.5">{consoleMetrics.total}</span>
              </Card>
              <Card padding="xs" className="flex flex-col">
                <span className="text-[11px] text-danger uppercase font-medium tracking-wide">Errors</span>
                <span className="text-xl font-bold text-danger font-mono mt-0.5">{consoleMetrics.errors}</span>
              </Card>
              <Card padding="xs" className="flex flex-col">
                <span className="text-[11px] text-warning uppercase font-medium tracking-wide">Warnings</span>
                <span className="text-xl font-bold text-warning font-mono mt-0.5">{consoleMetrics.warns}</span>
              </Card>
              <Card padding="xs" className="flex flex-col">
                <span className="text-[11px] text-primary uppercase font-medium tracking-wide">Stream Status</span>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`size-2 rounded-full ${consoleConnected ? "bg-success" : "bg-danger"}`} />
                  <span className="text-sm font-bold text-text-main font-mono">
                    {consoleConnected ? "Connected" : "Offline"}
                  </span>
                </div>
              </Card>
            </div>

            {/* Standard Search & Filter Row (Identical layout to Error Records) */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 lg:col-start-2 lg:row-start-1">
              <div className="relative flex-1 sm:max-w-sm">
                <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-text-muted">
                  find_in_page
                </span>
                <input
                  type="text"
                  value={consoleFilter}
                  onChange={(e) => setConsoleFilter(e.target.value)}
                  placeholder="Filter console by keyword or tag..."
                  className="w-full rounded-[10px] border border-border-subtle bg-surface-2 py-2 pl-9 pr-8 text-xs text-text-main placeholder-text-muted/60 transition-colors focus:border-brand-500/50 focus:outline-none focus:ring-1 focus:ring-brand-500/30 font-sans"
                />
                {consoleFilter && (
                  <button
                    type="button"
                    onClick={() => setConsoleFilter("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main p-0.5"
                  >
                    <span className="material-symbols-outlined text-[15px]">cancel</span>
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <SegmentedControl
                  size="sm"
                  options={[
                    { value: "all", label: `All (${consoleLogs.length})` },
                    { value: "report_problem", label: `Err (${consoleMetrics.errors})` },
                    { value: "warn", label: `Warn (${consoleMetrics.warns})` },
                    { value: "info", label: `Info (${consoleMetrics.info})` },
                  ]}
                  value={consoleLevel}
                  onChange={setConsoleLevel}
                />

                <Button
                  size="sm"
                  variant={autoScroll ? "primary" : "outline"}
                  onClick={() => setAutoScroll(!autoScroll)}
                  icon={autoScroll ? "south" : "pause_circle"}
                >
                  {autoScroll ? "Auto-scroll" : "Paused"}
                </Button>

                {consoleLogs.length > 0 && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      icon={consoleCopiedId === "all-console" ? "task_alt" : "file_copy"}
                      onClick={handleCopyAllConsole}
                    >
                      {consoleCopiedId === "all-console" ? "Copied" : "Copy"}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      icon="delete_sweep"
                      onClick={handleClearConsole}
                    >
                      Clear
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Console Log List (Identical Card style to Error Records) */}
            <Card padding="none" className="divide-y divide-border-subtle max-h-[calc(100dvh-320px)] overflow-y-auto lg:col-start-2 lg:row-start-2">
              <div ref={consoleRef}>
                {filteredConsoleItems.length === 0 ? (
                  <div className="py-16 text-center text-xs text-text-muted">
                    {consoleLogs.length === 0 ? "No console output recorded." : "No lines match search filter."}
                  </div>
                ) : (
                  filteredConsoleItems.map((item) => (
                    <div key={item.index} className="p-3 text-xs transition-colors hover:bg-surface-2/40">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 flex-1 min-w-0">
                          <Badge variant={item.variant} size="sm" className="mt-0.5 shrink-0 font-mono">
                            {item.tag}
                          </Badge>

                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted font-mono">
                              <span>Line #{item.index + 1}</span>
                              {item.timestamp && <span>{item.timestamp}</span>}
                            </div>
                            <div className="mt-1 font-mono text-xs text-text-main break-words whitespace-pre-wrap leading-relaxed select-text">
                              {stripEmoji(item.raw)}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => copyText(item.raw, `line-${item.index}`, setConsoleCopiedId)}
                            className="p-1 rounded text-text-muted hover:text-text-main transition-colors"
                            title="Copy line"
                          >
                            <span className="material-symbols-outlined text-[16px]">
                              {consoleCopiedId === `line-${item.index}` ? "task_alt" : "file_copy"}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        )}
      </div>
    </PageShell>
  );
}
