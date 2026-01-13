"use client";

import { useState, useEffect } from "react";
import Card from "./Card";
import Modal from "./Modal";
import Button from "./Button";
import { cn } from "@/shared/utils/cn";

export default function RequestLogger() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  
  // Modal state for log details
  const [selectedLog, setSelectedLog] = useState(null);
  const [logDetails, setLogDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  
  // Copy state
  const [copiedRequest, setCopiedRequest] = useState(false);
  const [copiedResponse, setCopiedResponse] = useState(false);

  useEffect(() => {
    fetchLogs();
  }, []);

  useEffect(() => {
    let interval;
    if (autoRefresh) {
      interval = setInterval(() => {
        fetchLogs(false);
      }, 500);
    }
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const fetchLogs = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/usage/logs");
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (error) {
      console.error("Failed to fetch logs:", error);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const handleLogClick = async (log) => {
    if (!log.logId) return; // Old logs without logId
    
    setSelectedLog(log);
    setLoadingDetails(true);
    setLogDetails(null);
    
    // Small delay to prevent flash when loading is very fast
    const minLoadingTime = 150;
    const startTime = Date.now();
    
    try {
      const res = await fetch(`/api/usage/logs/${log.logId}`);
      if (res.ok) {
        const data = await res.json();
        
        // Ensure minimum loading time
        const elapsed = Date.now() - startTime;
        if (elapsed < minLoadingTime) {
          await new Promise(resolve => setTimeout(resolve, minLoadingTime - elapsed));
        }
        
        setLogDetails(data);
      }
    } catch (error) {
      console.error("Failed to fetch log details:", error);
    } finally {
      setLoadingDetails(false);
    }
  };

  const copyToClipboard = async (text, type) => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === "request") {
        setCopiedRequest(true);
        setTimeout(() => setCopiedRequest(false), 2000);
      } else {
        setCopiedResponse(true);
        setTimeout(() => setCopiedResponse(false), 2000);
      }
    } catch (err) {
      console.log("Failed to copy:", err);
    }
  };

  // Skeleton block component for loading state
  const SkeletonBlock = ({ label, icon, iconColor }) => (
    <div>
      <h3 className="text-sm font-semibold text-text-main mb-2 flex items-center gap-2">
        <span className={cn("material-symbols-outlined text-[18px]", iconColor)}>{icon}</span>
        {label}
      </h3>
      <div className="relative">
        <div className="bg-black/5 dark:bg-black/30 p-4 rounded-lg min-h-[120px] max-h-[300px] border border-border overflow-hidden">
          <div className="space-y-2 animate-pulse">
            <div className="h-3 bg-black/10 dark:bg-white/10 rounded w-3/4"></div>
            <div className="h-3 bg-black/10 dark:bg-white/10 rounded w-1/2"></div>
            <div className="h-3 bg-black/10 dark:bg-white/10 rounded w-5/6"></div>
            <div className="h-3 bg-black/10 dark:bg-white/10 rounded w-2/3"></div>
            <div className="h-3 bg-black/10 dark:bg-white/10 rounded w-4/5"></div>
          </div>
        </div>
      </div>
    </div>
  );

  const closeModal = () => {
    setSelectedLog(null);
    setLogDetails(null);
  };

  const formatJson = (data) => {
    if (!data) return "null";
    if (typeof data === "string") return data;
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Request Logs</h2>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-text-muted flex items-center gap-2 cursor-pointer">
            <span>Auto Refresh (500ms)</span>
            <div
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                autoRefresh ? "bg-primary" : "bg-bg-subtle border border-border"
              }`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                  autoRefresh ? "translate-x-5" : "translate-x-1"
                }`}
              />
            </div>
          </label>
        </div>
      </div>

      <Card className="overflow-hidden bg-black/5 dark:bg-black/20">
        <div className="p-0 overflow-x-auto max-h-[600px] overflow-y-auto font-mono text-xs">
          {loading && logs.length === 0 ? (
            <div className="p-8 text-center text-text-muted">Loading logs...</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-text-muted">No logs recorded yet.</div>
          ) : (
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="sticky top-0 bg-bg-subtle border-b border-border z-10">
                <tr>
                  <th className="px-3 py-2 border-r border-border">DateTime</th>
                  <th className="px-3 py-2 border-r border-border">Model</th>
                  <th className="px-3 py-2 border-r border-border">Provider</th>
                  <th className="px-3 py-2 border-r border-border">Account</th>
                  <th className="px-3 py-2 border-r border-border">In</th>
                  <th className="px-3 py-2 border-r border-border">Out</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {logs.map((log, i) => {
                  const isPending = log.status?.includes("PENDING");
                  const isFailed = log.status?.includes("FAILED");
                  const isSuccess = log.status?.includes("OK");
                  const hasDetails = !!log.logId;

                  return (
                    <tr 
                      key={i} 
                      onClick={() => hasDetails && handleLogClick(log)}
                      className={cn(
                        "transition-colors",
                        hasDetails ? "cursor-pointer hover:bg-primary/10" : "",
                        isPending && "bg-primary/5"
                      )}
                    >
                      <td className="px-3 py-1.5 border-r border-border text-text-muted">{log.datetime}</td>
                      <td className="px-3 py-1.5 border-r border-border font-medium">{log.model}</td>
                      <td className="px-3 py-1.5 border-r border-border">
                        <span className="px-1.5 py-0.5 rounded bg-bg-subtle border border-border text-[10px] uppercase font-bold">
                          {log.provider}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 border-r border-border truncate max-w-[150px]" title={log.account}>{log.account}</td>
                      <td className="px-3 py-1.5 border-r border-border text-right text-primary">{log.tokensIn}</td>
                      <td className="px-3 py-1.5 border-r border-border text-right text-green-500">{log.tokensOut}</td>
                      <td className={cn(
                        "px-3 py-1.5 font-bold",
                        isSuccess && "text-green-500",
                        isFailed && "text-red-500",
                        isPending && "text-primary animate-pulse"
                      )}>
                        <span className="flex items-center gap-1">
                          {log.status}
                          {hasDetails && (
                            <span className="material-symbols-outlined text-[14px] text-text-muted">open_in_new</span>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>
      <div className="text-[10px] text-text-muted italic">
        Click on a log row to inspect request and response details.
      </div>

      {/* Log Details Modal */}
      <Modal
        isOpen={!!selectedLog}
        onClose={closeModal}
        title={selectedLog ? `${selectedLog.model} - ${selectedLog.datetime}` : ""}
        size="full"
      >
        {loadingDetails ? (
          <div className="flex flex-col gap-6">
            {/* Skeleton Header */}
            <div className="flex items-center gap-4">
              <div className="h-4 bg-black/10 dark:bg-white/10 rounded w-24 animate-pulse"></div>
              <div className="h-4 bg-black/10 dark:bg-white/10 rounded w-32 animate-pulse"></div>
              <div className="h-4 bg-black/10 dark:bg-white/10 rounded w-20 animate-pulse"></div>
            </div>

            {/* Skeleton Request Body */}
            <SkeletonBlock label="Request Body" icon="upload" iconColor="text-primary" />
            
            {/* Skeleton Response Body */}
            <SkeletonBlock label="Response Body" icon="download" iconColor="text-green-500" />
          </div>
        ) : logDetails ? (
          <div className="flex flex-col gap-6">
            {/* Request Header */}
            <div className="flex items-center gap-4 text-sm text-text-muted">
              <span className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">dns</span>
                {selectedLog?.provider}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">account_circle</span>
                {selectedLog?.account}
              </span>
              <span className={cn(
                "flex items-center gap-1.5 font-medium",
                selectedLog?.status?.includes("OK") && "text-green-500",
                selectedLog?.status?.includes("FAILED") && "text-red-500"
              )}>
                <span className="material-symbols-outlined text-[16px]">
                  {selectedLog?.status?.includes("OK") ? "check_circle" : "error"}
                </span>
                {selectedLog?.status}
              </span>
            </div>

            {/* Request Body Section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-text-main flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[18px]">upload</span>
                  Request Body
                </h3>
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(formatJson(logDetails.requestBody), "request")}>
                  <span className="material-symbols-outlined text-[14px] mr-1">{copiedRequest ? "check" : "content_copy"}</span>
                  {copiedRequest ? "Copied!" : "Copy"}
                </Button>
              </div>
              <pre className="bg-black/5 dark:bg-black/30 p-4 rounded-lg overflow-auto min-h-[120px] max-h-[300px] text-xs font-mono text-text-main border border-border">
                {formatJson(logDetails.requestBody)}
              </pre>
            </div>
            
            {/* Response Body Section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-text-main flex items-center gap-2">
                  <span className="material-symbols-outlined text-green-500 text-[18px]">download</span>
                  Response Body
                </h3>
                {logDetails.responseBody && (
                  <Button variant="ghost" size="sm" onClick={() => copyToClipboard(formatJson(logDetails.responseBody), "response")}>
                    <span className="material-symbols-outlined text-[14px] mr-1">{copiedResponse ? "check" : "content_copy"}</span>
                    {copiedResponse ? "Copied!" : "Copy"}
                  </Button>
                )}
              </div>
              <pre className="bg-black/5 dark:bg-black/30 p-4 rounded-lg overflow-auto min-h-[120px] max-h-[300px] text-xs font-mono text-text-main border border-border">
                {logDetails.responseBody 
                  ? formatJson(logDetails.responseBody)
                  : <span className="text-text-muted italic">No response body (request may still be pending)</span>
                }
              </pre>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center min-h-[400px] text-text-muted">
            <span className="material-symbols-outlined text-4xl mb-2">info</span>
            No details available for this log.
          </div>
        )}
      </Modal>
    </div>
  );
}
